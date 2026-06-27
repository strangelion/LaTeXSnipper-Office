# Replace VBA in .dotm using Word COM automation
param([string]$DotmPath = "$PSScriptRoot\out\LaTeXSnipper.dotm")

$ErrorActionPreference = "Stop"
$vbaDir = "$PSScriptRoot\vba"
$vba1 = Get-Content "$vbaDir\LaTeXSnipper.bas" -Raw
$vba2 = Get-Content "$vbaDir\LaTeXSnipperRibbon.bas" -Raw

Write-Host "Replacing VBA in $DotmPath..." -ForegroundColor Cyan

try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0

    $doc = $word.Documents.Open($DotmPath)
    $vb = $doc.VBProject

    # Remove existing modules (both original Zotero names and LaTeXSnipper names)
    foreach ($comp in $vb.VBComponents) {
        if ($comp.Name -eq "Zotero" -or $comp.Name -eq "ZoteroRibbon" -or
            $comp.Name -eq "LaTeXSnipper" -or $comp.Name -eq "LaTeXSnipperRibbon") {
            $vb.VBComponents.Remove($comp)
        }
    }

    # Add modules
    $m1 = $vb.VBComponents.Add(1)
    $m1.Name = "LaTeXSnipper"
    $m1.CodeModule.AddFromString($vba1)
    Write-Host "  + LaTeXSnipper.bas ($($vba1.Length) chars)" -ForegroundColor Gray

    $m2 = $vb.VBComponents.Add(1)
    $m2.Name = "LaTeXSnipperRibbon"
    $m2.CodeModule.AddFromString($vba2)
    Write-Host "  + LaTeXSnipperRibbon.bas ($($vba2.Length) chars)" -ForegroundColor Gray

    $doc.Save()
    $doc.Close(0)
    $word.Quit()
    Write-Host "VBA replaced successfully" -ForegroundColor Green
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($word) { try { $word.Quit() } catch {} }
    exit 1
}
