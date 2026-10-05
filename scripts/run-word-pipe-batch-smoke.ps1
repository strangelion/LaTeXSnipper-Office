[CmdletBinding()]
param(
    [string]$OutputDirectory = '',
    [ValidateSet('LaTeXSnipper.Word', 'LaTeXSnipper.NativeOffice.Word')]
    [string]$AddinProgId = 'LaTeXSnipper.Word',
    [string]$ExpectedStagingRoot = '',
    [switch]$IsolateDevelopmentAddin,
    [switch]$VerifyUi
)

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
$addinRegistryRoot = 'Registry::HKEY_CURRENT_USER\Software\Microsoft\Office\Word\Addins'
$manifest = (Get-ItemProperty -LiteralPath (Join-Path $addinRegistryRoot $AddinProgId)).Manifest
$manifestPath = ($manifest -split '\|')[0]
if ($manifestPath.StartsWith('file:', [StringComparison]::OrdinalIgnoreCase)) {
    $manifestPath = ([uri]$manifestPath).LocalPath
}
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'The registered VSTO manifest is missing. Build or install signed manifests before starting Word.'
}
$addinDirectory = Split-Path -Parent $manifestPath
$installedAddin = $AddinProgId -eq 'LaTeXSnipper.NativeOffice.Word'
if ($installedAddin) {
    $installedRoot = Join-Path $env:LOCALAPPDATA 'LaTeXSnipper\NativeOffice'
    $expectedManifest = Join-Path $installedRoot 'Word\LaTeXSnipper.Word.vsto'
    if ([IO.Path]::GetFullPath($manifestPath) -ne [IO.Path]::GetFullPath($expectedManifest)) {
        throw 'Installed-addin acceptance requires the exact per-user installed manifest.'
    }
    if (-not $ExpectedStagingRoot) { throw 'Installed-addin acceptance requires ExpectedStagingRoot.' }
    $expectedProvenance = Join-Path $ExpectedStagingRoot 'build-provenance.json'
    $installedProvenance = Join-Path $installedRoot 'build-provenance.json'
    if ((Get-FileHash -LiteralPath $expectedProvenance).Hash -ne (Get-FileHash -LiteralPath $installedProvenance).Hash) {
        throw 'Installed payload provenance differs from the expected staging.'
    }
    $provenance = Get-Content -LiteralPath $expectedProvenance -Raw | ConvertFrom-Json
    foreach ($property in $provenance.payloadHashes.PSObject.Properties) {
        $installedFile = [IO.Path]::GetFullPath((Join-Path $installedRoot $property.Name))
        if (-not $installedFile.StartsWith($installedRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Payload hash path escapes the installed root.'
        }
        if ((Get-FileHash -LiteralPath $installedFile).Hash -ne $property.Value) {
            throw "Installed payload hash mismatch: $($property.Name)"
        }
    }
}
$binaries = @($manifestPath, (Join-Path $addinDirectory 'LaTeXSnipper.Word.dll'), (Join-Path $addinDirectory 'LaTeXSnipper.NativeOffice.Shared.dll'))
$binaryHashes = @($binaries | ForEach-Object {
    $binary = Get-FileHash -LiteralPath $_ -Algorithm SHA256
    [ordered]@{ file = (Split-Path -Leaf $_); sha256 = $binary.Hash }
})
[ordered]@{ registeredDevelopmentManifest = -not $installedAddin; installedAddin = $installedAddin; addinProgId = $AddinProgId; binaries = $binaryHashes } |
    ConvertTo-Json -Depth 4 | Tee-Object -FilePath (Join-Path $outputPath 'addin-preflight.json')
$oldTarget = $env:NATIVE_BATCH_TEST_DOCUMENT
$oldUiMode = $env:NATIVE_BATCH_TEST_UI
$word = $null
$document = $null
$addin = $null
$developmentAddin = $null
$developmentKey = Join-Path $addinRegistryRoot 'LaTeXSnipper.Word'
$developmentLoadBehavior = $null
Push-Location $repoRoot
try {
    if ($installedAddin -and (Test-Path -LiteralPath $developmentKey)) {
        $developmentLoadBehavior = (Get-ItemProperty -LiteralPath $developmentKey).LoadBehavior
        if ($null -eq $developmentLoadBehavior) { throw 'Development add-in LoadBehavior is missing; no registry change was made.' }
        if ($developmentLoadBehavior -ne 0 -and -not $IsolateDevelopmentAddin) {
            throw 'A development add-in is also enabled. Explicitly isolate it for installed-addin acceptance.'
        }
        if ($IsolateDevelopmentAddin) {
            Set-ItemProperty -LiteralPath $developmentKey -Name LoadBehavior -Value 0
        }
    }
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
    $addin = $word.COMAddIns.Item($AddinProgId)
    if (-not $addin.Connect) { $addin.Connect = $true }
    if (-not $addin.Connect) { throw 'The real Word VSTO add-in did not load.' }
    if ($installedAddin) {
        if (Test-Path -LiteralPath $developmentKey) {
            $developmentAddin = $word.COMAddIns.Item('LaTeXSnipper.Word')
            if ($developmentAddin.Connect) {
                throw 'The development add-in loaded during installed-addin acceptance.'
            }
        }
    }

    $env:NATIVE_BATCH_TEST_DOCUMENT = $documentPath
    $env:NATIVE_BATCH_TEST_UI = if ($VerifyUi) { '1' } else { '0' }
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
    try {
        $env:NATIVE_BATCH_TEST_DOCUMENT = $oldTarget
        $env:NATIVE_BATCH_TEST_UI = $oldUiMode
        if ($document) {
            try { $document.Close(0) } catch { Write-Warning $_.Exception.Message }
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
        }
        foreach ($addinReference in @($developmentAddin, $addin)) {
            if ($addinReference) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($addinReference) }
        }
        if ($word) {
            try { $word.Quit(0) } catch { Write-Warning $_.Exception.Message }
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)
        }
    }
    finally {
        if ($null -ne $developmentLoadBehavior -and $IsolateDevelopmentAddin) {
            Set-ItemProperty -LiteralPath $developmentKey -Name LoadBehavior -Value $developmentLoadBehavior
        }
        Pop-Location
    }
}
