[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$WpsZip,
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Destination = "",
    [string]$DiagnosticsDirectory = "package-diagnostics"
)

$ErrorActionPreference = "Stop"
$zip = (Resolve-Path -LiteralPath $WpsZip -ErrorAction Stop).Path
if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path (Get-Location) "apps\wps\dist\latexsnipper-wps_$Version"
}
$destinationPath = if ([System.IO.Path]::IsPathRooted($Destination)) {
    [System.IO.Path]::GetFullPath($Destination)
} else {
    [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Destination))
}
$distRoot = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) "apps\wps\dist"))
if (-not $destinationPath.StartsWith($distRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "WPS extraction destination must be inside apps/wps/dist: $destinationPath"
}
if ((Split-Path -Leaf $zip) -ne "latexsnipper-wps_$Version.zip") {
    throw "WPS artifact ZIP name mismatch: expected=latexsnipper-wps_$Version.zip actual=$(Split-Path -Leaf $zip)"
}
if (Test-Path -LiteralPath $destinationPath) {
    Remove-Item -LiteralPath $destinationPath -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $destinationPath, $DiagnosticsDirectory | Out-Null
Expand-Archive -LiteralPath $zip -DestinationPath $destinationPath -Force

$required = @(
    "index.html", "main.js", "manifest.xml", "ribbon.xml", "proxy.js", "server.js",
    "js/command-layer.js", "js/ribbon.js", "js/util.js", "ui/taskpane.html"
)
foreach ($relative in $required) {
    $path = Join-Path $destinationPath ($relative -replace '/', [System.IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "WPS artifact missing required file: $relative"
    }
}
foreach ($nested in @("WPS", "resources\WPS", "latexsnipper-wps_$Version")) {
    if (Test-Path -LiteralPath (Join-Path $destinationPath $nested)) {
        throw "WPS artifact contains forbidden nested root: $nested"
    }
}
$tree = Get-ChildItem -LiteralPath $destinationPath -Recurse -File | Sort-Object FullName
$tree | Select-Object FullName, Length | Format-Table -AutoSize |
    Out-File (Join-Path $DiagnosticsDirectory "wps-extraction-tree.txt") -Encoding UTF8
$required | ForEach-Object {
    $path = Join-Path $destinationPath ($_ -replace '/', [System.IO.Path]::DirectorySeparatorChar)
    [pscustomobject]@{ RelativePath = $_; SHA256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash }
} | ConvertTo-Json | Set-Content (Join-Path $DiagnosticsDirectory "wps-required-hashes.json") -Encoding UTF8
Write-Host "WPS artifact staged: $destinationPath"
Write-Output $destinationPath
