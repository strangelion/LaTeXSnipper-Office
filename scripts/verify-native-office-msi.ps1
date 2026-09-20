[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$Path)

$ErrorActionPreference = "Stop"
$msi = (Resolve-Path -LiteralPath $Path).Path
$installer = $null
$database = $null

function Read-MsiRows([string]$Query, [int]$Columns) {
    $view = $null
    try {
        $view = $database.GetType().InvokeMember("OpenView", "InvokeMethod", $null, $database, @($Query))
        $view.GetType().InvokeMember("Execute", "InvokeMethod", $null, $view, $null) | Out-Null
        while ($true) {
            $record = $view.GetType().InvokeMember("Fetch", "InvokeMethod", $null, $view, $null)
            if ($null -eq $record) { break }
            try {
                $values = @()
                for ($column = 1; $column -le $Columns; $column++) {
                    $values += $record.GetType().InvokeMember("StringData", "GetProperty", $null, $record, $column)
                }
                Write-Output -NoEnumerate $values
            } finally { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($record) | Out-Null }
        }
    } finally {
        if ($view) {
            $view.GetType().InvokeMember("Close", "InvokeMethod", $null, $view, $null) | Out-Null
            [Runtime.InteropServices.Marshal]::FinalReleaseComObject($view) | Out-Null
        }
    }
}

try {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.GetType().InvokeMember("OpenDatabase", "InvokeMethod", $null, $installer, @($msi, 0))
    $files = @(Read-MsiRows 'SELECT `FileName`, `FileSize`, `Sequence` FROM `File`' 3)
    $media = @(Read-MsiRows 'SELECT `LastSequence`, `Cabinet` FROM `Media` ORDER BY `DiskId`' 2)
    $streams = @(Read-MsiRows 'SELECT `Name` FROM `_Streams`' 1)
    foreach ($name in @("OleFormulaObject.x64.dll", "OleFormulaObject.x86.dll")) {
        $matches = @($files | Where-Object { ($_[0] -split '\|')[-1] -eq $name })
        if ($matches.Count -ne 1 -or [long]$matches[0][1] -le 0) {
            throw "NativeOffice MSI must contain exactly one nonempty $name"
        }
        $sequence = [int]$matches[0][2]
        $cabinet = $media | Where-Object { [int]$_[0] -ge $sequence } | Select-Object -First 1
        if (-not $cabinet -or -not ([string]$cabinet[1]).StartsWith('#')) {
            throw "OLE DLL must be in an embedded cabinet: $name"
        }
        $streamName = ([string]$cabinet[1]).Substring(1)
        if (-not ($streams | Where-Object { $_[0] -eq $streamName })) {
            throw "MSI embedded cabinet is missing for $name"
        }
        Write-Host "  OLE payload verified in MSI: $name ($($matches[0][1]) bytes)"
    }
} finally {
    if ($database) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($database) | Out-Null }
    if ($installer) { [Runtime.InteropServices.Marshal]::FinalReleaseComObject($installer) | Out-Null }
}
