@echo off
setlocal
set VERSION=%1
if "%VERSION%"=="" set VERSION=1.0.0
set SCRIPT_DIR=%~dp0
set DIST_DIR=%SCRIPT_DIR%..\dist
set PLUGIN_NAME=LaTeXSnipper

if exist "%DIST_DIR%" rmdir /s /q "%DIST_DIR%"
mkdir "%DIST_DIR%"

:: Copy all plugin files for offline package
mkdir "%DIST_DIR%\%PLUGIN_NAME%"
copy /Y "%SCRIPT_DIR%index.html" "%DIST_DIR%\%PLUGIN_NAME%\" >nul
copy /Y "%SCRIPT_DIR%main.js" "%DIST_DIR%\%PLUGIN_NAME%\" >nul
copy /Y "%SCRIPT_DIR%manifest.xml" "%DIST_DIR%\%PLUGIN_NAME%\" >nul
copy /Y "%SCRIPT_DIR%ribbon.xml" "%DIST_DIR%\%PLUGIN_NAME%\" >nul
copy /Y "%SCRIPT_DIR%server.js" "%DIST_DIR%\%PLUGIN_NAME%\" >nul
copy /Y "%SCRIPT_DIR%package.json" "%DIST_DIR%\%PLUGIN_NAME%\" >nul
mkdir "%DIST_DIR%\%PLUGIN_NAME%\js"
copy /Y "%SCRIPT_DIR%js\ribbon.js" "%DIST_DIR%\%PLUGIN_NAME%\js\" >nul
copy /Y "%SCRIPT_DIR%js\util.js" "%DIST_DIR%\%PLUGIN_NAME%\js\" >nul
mkdir "%DIST_DIR%\%PLUGIN_NAME%\ui"
copy /Y "%SCRIPT_DIR%ui\taskpane.html" "%DIST_DIR%\%PLUGIN_NAME%\ui\" >nul
mkdir "%DIST_DIR%\%PLUGIN_NAME%\images"
copy /Y "%SCRIPT_DIR%images\*.svg" "%DIST_DIR%\%PLUGIN_NAME%\images\" >nul

:: Create 7z package for offline distribution
where 7z >nul 2>&1
if %ERRORLEVEL% equ 0 (
    7z a -t7z "%DIST_DIR%\%PLUGIN_NAME%.7z" "%DIST_DIR%\%PLUGIN_NAME%" -mx=9
    echo 7z package created
) else (
    powershell -Command "Compress-Archive -Path '%DIST_DIR%\%PLUGIN_NAME%' -DestinationPath '%DIST_DIR%\%PLUGIN_NAME%.zip' -Force"
    echo ZIP package created (7z not found)
)

echo Done: %DIST_DIR%
