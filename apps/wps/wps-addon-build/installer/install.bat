@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo   LaTeXSnipper WPS Plugin Installer
echo ========================================
echo.

:: Check if WPS is running
tasklist /FI "IMAGENAME eq wps.exe" 2>NUL | find /I "wps.exe" >NUL
if %ERRORLEVEL% equ 0 (
    echo [WARNING] WPS Office is running. Please close it first.
    echo.
    set /p CLOSE_WPS="Close WPS now? (Y/N): "
    if /I "!CLOSE_WPS!"=="Y" (
        taskkill /F /IM wps.exe >NUL 2>&1
        timeout /t 2 >nul
    ) else (
        echo Installation cancelled.
        pause
        exit /b 1
    )
)

:: Set paths
set PLUGIN_NAME=latexsnipper-wps
set JSADDONS=%APPDATA%\kingsoft\wps\jsaddons
set PLUGIN_DIR=%JSADDONS%\%PLUGIN_NAME%
set SCRIPT_DIR=%~dp0

:: Create directories
echo [1/3] Creating directories...
if not exist "%JSADDONS%" mkdir "%JSADDONS%"
if not exist "%PLUGIN_DIR%" mkdir "%PLUGIN_DIR%"
if not exist "%PLUGIN_DIR%\js" mkdir "%PLUGIN_DIR%\js"
if not exist "%PLUGIN_DIR%\images" mkdir "%PLUGIN_DIR%\images"
if not exist "%PLUGIN_DIR%\ui" mkdir "%PLUGIN_DIR%\ui"

:: Copy plugin files
echo [2/3] Copying plugin files...
copy /Y "%SCRIPT_DIR%index.html" "%PLUGIN_DIR%\" >nul
copy /Y "%SCRIPT_DIR%main.js" "%PLUGIN_DIR%\" >nul
copy /Y "%SCRIPT_DIR%manifest.xml" "%PLUGIN_DIR%\" >nul
copy /Y "%SCRIPT_DIR%ribbon.xml" "%PLUGIN_DIR%\" >nul
copy /Y "%SCRIPT_DIR%js\ribbon.js" "%PLUGIN_DIR%\js\" >nul
copy /Y "%SCRIPT_DIR%js\util.js" "%PLUGIN_DIR%\js\" >nul
copy /Y "%SCRIPT_DIR%images\*.svg" "%PLUGIN_DIR%\images\" >nul
copy /Y "%SCRIPT_DIR%ui\taskpane.html" "%PLUGIN_DIR%\ui\" >nul

:: Create publish.xml for offline mode
echo [3/3] Creating publish.xml...
(
echo ^<?xml version="1.0" encoding="UTF-8"?^>
echo ^<jsplugins^>
echo     ^<jspluginonline name="latexsnipper-wps" addonType="wps" online="false" enable="enable_dev"/^>
echo ^</jsplugins^>
) > "%JSADDONS%\publish.xml"

echo.
echo ========================================
echo   Installation Complete!
echo ========================================
echo.
echo Plugin installed to: %PLUGIN_DIR%
echo.
echo Please restart WPS Office to use LaTeXSnipper.
echo.
echo To uninstall, run: uninstall.bat
echo.
pause
