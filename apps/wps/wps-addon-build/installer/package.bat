@echo off
chcp 65001 >nul
setlocal

set SCRIPT_DIR=%~dp0
set SRC_DIR=%SCRIPT_DIR%..
set DEST_DIR=%SCRIPT_DIR%

echo Packaging LaTeXSnipper WPS Plugin Installer...

:: Copy plugin files
copy /Y "%SRC_DIR%\index.html" "%DEST_DIR%\" >nul
copy /Y "%SRC_DIR%\main.js" "%DEST_DIR%\" >nul
copy /Y "%SRC_DIR%\manifest.xml" "%DEST_DIR%\" >nul
copy /Y "%SRC_DIR%\ribbon.xml" "%DEST_DIR%\" >nul

:: Create subdirectories
if not exist "%DEST_DIR%\js" mkdir "%DEST_DIR%\js"
if not exist "%DEST_DIR%\images" mkdir "%DEST_DIR%\images"
if not exist "%DEST_DIR%\ui" mkdir "%DEST_DIR%\ui"

:: Copy sub-files
copy /Y "%SRC_DIR%\js\ribbon.js" "%DEST_DIR%\js\" >nul
copy /Y "%SRC_DIR%\js\util.js" "%DEST_DIR%\js\" >nul
copy /Y "%SRC_DIR%\images\*.svg" "%DEST_DIR%\images\" >nul
copy /Y "%SRC_DIR%\ui\taskpane.html" "%DEST_DIR%\ui\" >nul

echo.
echo Files copied to: %DEST_DIR%
echo.
echo To create zip package, run:
echo   powershell -Command "Compress-Archive -Path '%DEST_DIR%\*' -DestinationPath '%DEST_DIR%\..\..\..\dist\LaTeXSnipper-wps.zip'"
echo.
pause
