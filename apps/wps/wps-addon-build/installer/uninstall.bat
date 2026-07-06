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

echo Removing publish.xml entry...
:: Regenerate publish.xml without our plugin
(
echo ^<?xml version="1.0" encoding="UTF-8"?^>
echo ^<jsplugins^>
echo ^</jsplugins^>
) > "%JSADDONS%\publish.xml"

echo.
echo Uninstall complete!
echo Please restart WPS Office.
echo.
pause
