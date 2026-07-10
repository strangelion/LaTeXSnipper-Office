$ErrorActionPreference = "Stop"
$url = "https://raw.githubusercontent.com/nlohmann/json/v3.11.3/single_include/nlohmann/json.hpp"
$expectedSha256 = "9BEA4C8066EF4A1C206B2BE5A36302F8926F7FDC6087AF5D20B417D0CF103EA6"
$output = Join-Path $PSScriptRoot "json.hpp"
$temporary = "$output.download"

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $temporary -UseBasicParsing
    $actualSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $temporary).Hash.ToUpperInvariant()
    if ($actualSha256 -ne $expectedSha256) {
        throw "nlohmann/json v3.11.3 SHA256 mismatch. Expected $expectedSha256, got $actualSha256."
    }
    Move-Item -LiteralPath $temporary -Destination $output -Force
    Write-Host "Verified nlohmann/json v3.11.3: $actualSha256"
}
finally {
    if (Test-Path -LiteralPath $temporary) {
        Remove-Item -LiteralPath $temporary -Force
    }
}
