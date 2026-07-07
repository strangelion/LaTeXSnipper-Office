# Download nlohmann/json single-header library
# Run this once before building the OLE DLL
$url = "https://raw.githubusercontent.com/nlohmann/json/develop/single_include/nlohmann/json.hpp"
$output = Join-Path $PSScriptRoot "json.hpp"
Write-Host "Downloading nlohmann/json.hpp from $url ..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -Uri $url -OutFile $output -UseBasicParsing
if (Test-Path $output) {
    Write-Host "Downloaded $((Get-Item $output).Length) bytes to $output" -ForegroundColor Green
} else {
    Write-Error "Download failed"
}
