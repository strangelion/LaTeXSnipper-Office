@echo off
chcp 65001 >nul

echo ========================================
echo   LaTeXSnipper WPS Plugin Uninstaller
echo ========================================
echo.

set PLUGIN_NAME=latexsnipper-wps
set JSADDONS=%APPDATA%\kingsoft\wps\jsaddons
set PLUGIN_DIR=%JSADDONS%\%PLUGIN_NAME%

if not exist "%PLUGIN_DIR%" (
    echo Plugin not found. Nothing to uninstall.
    pause
    exit /b 0
)

echo Removing plugin files...
rmdir /s /q "%PLUGIN_DIR%" 2>nul

echo Removing publish.xml entry (preserving other plugins)...
set PUBLISH_XML=%JSADDONS%\publish.xml
if exist "%PUBLISH_XML%" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
      $xml = [xml](Get-Content '%PUBLISH_XML%' -Raw); ^
      $nodes = $xml.DocumentElement.SelectNodes('//jspluginonline[@name="latexsnipper-wps"]'); ^
      for ($i = $nodes.Count - 1; $i -ge 0; $i--) { ^
        [void]$nodes[$i].ParentNode.RemoveChild($nodes[$i]) ^
      }; ^
      $xml.Save('%PUBLISH_XML%')
)

echo.
echo Uninstall complete!
echo Please restart WPS Office.
echo.
pause
