[CmdletBinding()]
param([string]$OutputDirectory = '')

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
if (Get-Process WINWORD -ErrorAction SilentlyContinue) {
    throw 'Close Word before running this dedicated host test; existing documents will not be touched.'
}
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $repoRoot ('src-tauri\target\word-pipe-batch-' + [guid]::NewGuid().ToString('N'))
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$outputPath = (Resolve-Path -LiteralPath $OutputDirectory).Path
$documentPath = Join-Path $outputPath 'word-pipe-batch.docx'
if (Test-Path -LiteralPath $documentPath) {
    throw 'The harness DOCX already exists. Select a fresh output directory instead of overwriting evidence.'
}
$manifest = (Get-ItemProperty -LiteralPath 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Office\Word\Addins\LaTeXSnipper.Word').Manifest
$manifestPath = ($manifest -split '\|')[0]
if ($manifestPath.StartsWith('file:', [StringComparison]::OrdinalIgnoreCase)) {
    $manifestPath = ([uri]$manifestPath).LocalPath
}
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'The registered development VSTO manifest is missing. Build signed manifests before starting Word.'
}
$addinDirectory = Split-Path -Parent $manifestPath
$binaries = @($manifestPath, (Join-Path $addinDirectory 'LaTeXSnipper.Word.dll'), (Join-Path $addinDirectory 'LaTeXSnipper.Shared.dll'))
$binaryHashes = @($binaries | ForEach-Object {
    $binary = Get-FileHash -LiteralPath $_ -Algorithm SHA256
    [ordered]@{ file = (Split-Path -Leaf $_); sha256 = $binary.Hash }
})
[ordered]@{ registeredDevelopmentManifest = $true; binaries = $binaryHashes } |
    ConvertTo-Json -Depth 4 | Tee-Object -FilePath (Join-Path $outputPath 'addin-preflight.json')
$oldTarget = $env:NATIVE_BATCH_TEST_DOCUMENT
$word = $null
$document = $null
Push-Location $repoRoot
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $document = $word.Documents.Add()
    $lines = @(
        'Before0 $x^2$ After0',
        'Before1 $$\frac{1}{2}$$ After1',
        'Before2 \(x_1\) After2',
        'Before3 \[\sqrt{x}\] After3'
    )
    $document.Content.Text = ($lines -join "`r") + "`r"
    $document.SaveAs2($documentPath, 12)
    $document.Close(0)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
    $document = $null
    $document = $word.Documents.Open($documentPath)
    $document.Activate()
    $addin = $word.COMAddIns.Item('LaTeXSnipper.Word')
    if (-not $addin.Connect) { $addin.Connect = $true }
    if (-not $addin.Connect) { throw 'The real Word VSTO add-in did not load.' }

    $env:NATIVE_BATCH_TEST_DOCUMENT = $documentPath
    & node scripts/verify-native-batch-webview.mjs | Tee-Object -FilePath (Join-Path $outputPath 'pipe-result.json')
    if ($LASTEXITCODE -ne 0) { throw "WebView-to-Word batch smoke failed: exit $LASTEXITCODE" }
    if ($document.OMaths.Count -ne 4) { throw "Expected 4 real Word equations, got $($document.OMaths.Count)" }
    $document.Save()
    $document.Close(0)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
    $document = $null
    $document = $word.Documents.Open($documentPath, $false, $true)
    $text = $document.Content.Text
    for ($i = 0; $i -lt 4; $i++) {
        if (-not $text.Contains("Before$i") -or -not $text.Contains("After$i")) {
            throw "Adjacent prose marker $i did not survive reopen."
        }
    }
    if ($document.OMaths.Count -ne 4) { throw 'Equation count changed after save/reopen.' }
    [ordered]@{
        pass = $true
        wordVersion = $word.Version
        reopenedEquations = $document.OMaths.Count
        adjacentProsePreserved = $true
        documentSha256 = (Get-FileHash -LiteralPath $documentPath -Algorithm SHA256).Hash
    } | ConvertTo-Json | Tee-Object -FilePath (Join-Path $outputPath 'reopen-result.json')
    Write-Host "Evidence: $outputPath"
}
finally {
    $env:NATIVE_BATCH_TEST_DOCUMENT = $oldTarget
    if ($document) {
        try { $document.Close(0) } catch { Write-Warning $_.Exception.Message }
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
    }
    if ($word) {
        try { $word.Quit(0) } catch { Write-Warning $_.Exception.Message }
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
    }
    Pop-Location
}
