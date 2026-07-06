; LaTeXSnipper All-in-One Windows Installer (NSIS)
; Requires: Tauri NSIS installer + VSTO MSI/Bundle bundled in the same directory.

Unicode true
RequestExecutionLevel admin

!define PRODUCT_NAME "LaTeXSnipper Office"
!define PRODUCT_PUBLISHER "LaTeXSnipper"
!define PRODUCT_VERSION "3.0.0"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "LaTeXSnipper-Office-${PRODUCT_VERSION}-Setup.exe"
InstallDir "$PROGRAMFILES64\LaTeXSnipper"
ShowInstDetails show

; Mandatory: Tauri desktop installer (NSIS or MSI)
!define TAURI_INSTALLER "LaTeXSnipper_${PRODUCT_VERSION}_x64-setup.exe"
; Optional: VSTO Native Office bootstrapper
!define VSTO_INSTALLER "LaTeXSnipper.NativeOffice.exe"
; Plugin zips
!define WPS_PLUGIN_ZIP "latexsnipper-wps_${PRODUCT_VERSION}.zip"
!define OBSIDIAN_PLUGIN_ZIP "latexsnipper-obsidian_${PRODUCT_VERSION}.zip"

Section "LaTeXSnipper Desktop (required)" SecDesktop
  SectionIn RO
  SetOutPath "$INSTDIR"
  File "${TAURI_INSTALLER}"
  DetailPrint "Installing LaTeXSnipper Desktop..."
  ExecWait '"$INSTDIR\${TAURI_INSTALLER}" /S'
  Delete "$INSTDIR\${TAURI_INSTALLER}"
SectionEnd

Section "Native Office VSTO Add-in" SecVSTO
  SetOutPath "$INSTDIR\vsto"
  File /ifexists "${VSTO_INSTALLER}"
  IfFileExists "$INSTDIR\vsto\${VSTO_INSTALLER}" 0 skip_vsto
    DetailPrint "Installing LaTeXSnipper VSTO Add-in..."
    ExecWait '"$INSTDIR\vsto\${VSTO_INSTALLER}" /quiet /norestart'
  skip_vsto:
SectionEnd

Section "WPS Office Plugin" SecWPS
  SetOutPath "$INSTDIR\plugins"
  File /ifexists "${WPS_PLUGIN_ZIP}"
  DetailPrint "WPS plugin saved to: $INSTDIR\plugins\${WPS_PLUGIN_ZIP}"
  DetailPrint "Extract and run install.bat to install."
SectionEnd

Section "Obsidian Plugin" SecObsidian
  SetOutPath "$INSTDIR\plugins"
  File /ifexists "${OBSIDIAN_PLUGIN_ZIP}"
  DetailPrint "Obsidian plugin saved to: $INSTDIR\plugins\${OBSIDIAN_PLUGIN_ZIP}"
SectionEnd

; Descriptions for component selection
LangString DESC_SecDesktop ${LANG_ENGLISH} "LaTeXSnipper desktop application (required)"
LangString DESC_SecVSTO ${LANG_ENGLISH} "Native Office VSTO add-in for Word, Excel, and PowerPoint"
LangString DESC_SecWPS ${LANG_ENGLISH} "WPS Office plugin for formula insertion"
LangString DESC_SecObsidian ${LANG_ENGLISH} "Obsidian plugin for formula insertion"

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} $(DESC_SecDesktop)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecVSTO} $(DESC_SecVSTO)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecWPS} $(DESC_SecWPS)
  !insertmacro MUI_DESCRIPTION_TEXT ${SecObsidian} $(DESC_SecObsidian)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; Modern UI
!include "MUI2.nsh"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "English"
