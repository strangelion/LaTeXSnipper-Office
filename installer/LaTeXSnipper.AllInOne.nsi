; LaTeXSnipper All-in-One Windows Installer (NSIS)
; Requires: Tauri NSIS installer + VSTO MSI/Bundle bundled in the same directory.
; Build: makensis /DPRODUCT_VERSION=3.0.1 /DTAURI_INSTALLER=<full-path> /DVSTO_INSTALLER=<path> /DWPS_ZIP=<path> /DOBSIDIAN_ZIP=<path> LaTeXSnipper.AllInOne.nsi

Unicode true
RequestExecutionLevel admin

; ──── MUI2 must be included first ────────────────────────────────
!include "MUI2.nsh"

; ──── Version (required from CLI or fallback) ────────────────────
!ifndef PRODUCT_VERSION
  !define PRODUCT_VERSION "1.0.0"
!endif

!define PRODUCT_NAME "LaTeXSnipper Office"
!define PRODUCT_PUBLISHER "LaTeXSnipper"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "LaTeXSnipper-Office-${PRODUCT_VERSION}-Setup.exe"
InstallDir "$PROGRAMFILES64\LaTeXSnipper"
ShowInstDetails show

; ──── Required: Tauri desktop installer ──────────────────────────
!ifndef TAURI_INSTALLER
  !error "TAURI_INSTALLER must be provided by the release builder (use /DTAURI_INSTALLER=<path>)"
!endif

; ──── Optional components (paths from CLI defines) ────────────────
!ifdef VSTO_INSTALLER
  !define HAS_VSTO
!endif
!ifdef WPS_ZIP
  !define HAS_WPS
!endif
!ifdef OBSIDIAN_ZIP
  !define HAS_OBSIDIAN
!endif

; ──── Uninstall ──────────────────────────────────────────────────
Section "Uninstall"
  ; Remove VSTO
  IfFileExists "$INSTDIR\vsto\*.exe" 0 skip_vsto_uninstall
    DetailPrint "Uninstalling VSTO add-ins..."
    GetTempFileName $0 "$INSTDIR\vsto" "" ""  ; find first exe
    ; Run uninstaller if present
    FindFirst $0 $1 "$INSTDIR\vsto\*.exe"
    loop_vsto:
      StrCmp $1 "" done_vsto
      DetailPrint "  Running $1"
      ExecWait '"$INSTDIR\vsto\$1" /quiet /norestart'
      FindNext $0 $1
      Goto loop_vsto
    done_vsto:
    FindClose $0
  skip_vsto_uninstall:
  RMDir /r "$INSTDIR\vsto"

  ; Remove plugins
  Delete "$INSTDIR\plugins\*.zip"
  RMDir /r "$INSTDIR\plugins"

  ; Remove main directory
  RMDir /r "$INSTDIR"

  DetailPrint "Uninstall complete."
SectionEnd

; ──── Desktop (required) ─────────────────────────────────────────
Section "LaTeXSnipper Desktop (required)" SecDesktop
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /oname=LaTeXSnipper-Desktop-Setup.exe "${TAURI_INSTALLER}"
  DetailPrint "Installing LaTeXSnipper Desktop..."
  ExecWait '"$INSTDIR\LaTeXSnipper-Desktop-Setup.exe" /S'
  Delete "$INSTDIR\LaTeXSnipper-Desktop-Setup.exe"
SectionEnd

!ifdef HAS_VSTO
Section "Native Office VSTO Add-in" SecVSTO
  SetOutPath "$INSTDIR\vsto"
  File /oname=LaTeXSnipper.NativeOffice.exe "${VSTO_INSTALLER}"
  DetailPrint "Installing LaTeXSnipper VSTO Add-in..."
  ExecWait '"$INSTDIR\vsto\LaTeXSnipper.NativeOffice.exe" /quiet /norestart'
  Delete "$INSTDIR\vsto\LaTeXSnipper.NativeOffice.exe"
SectionEnd
!endif

!ifdef HAS_WPS
Section "WPS Office Plugin" SecWPS
  SetOutPath "$INSTDIR\plugins"
  File /oname=LaTeXSnipper-WPS-Plugin.zip "${WPS_ZIP}"
  DetailPrint "WPS plugin saved."
  DetailPrint "To install: extract to WPS jsaddons and run install.bat."
SectionEnd
!endif

!ifdef HAS_OBSIDIAN
Section "Obsidian Plugin" SecObsidian
  SetOutPath "$INSTDIR\plugins"
  File /oname=LaTeXSnipper-Obsidian-Plugin.zip "${OBSIDIAN_ZIP}"
  DetailPrint "Obsidian plugin saved."
SectionEnd
!endif

; ──── Component descriptions ─────────────────────────────────────
LangString DESC_SecDesktop ${LANG_ENGLISH} "LaTeXSnipper desktop application (required)"
LangString DESC_SecVSTO ${LANG_ENGLISH} "Native Office VSTO add-in for Word, Excel, and PowerPoint"
LangString DESC_SecWPS ${LANG_ENGLISH} "WPS Office plugin for formula insertion"
LangString DESC_SecObsidian ${LANG_ENGLISH} "Obsidian plugin for formula insertion"

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} $(DESC_SecDesktop)
  !ifdef HAS_VSTO
    !insertmacro MUI_DESCRIPTION_TEXT ${SecVSTO} $(DESC_SecVSTO)
  !endif
  !ifdef HAS_WPS
    !insertmacro MUI_DESCRIPTION_TEXT ${SecWPS} $(DESC_SecWPS)
  !endif
  !ifdef HAS_OBSIDIAN
    !insertmacro MUI_DESCRIPTION_TEXT ${SecObsidian} $(DESC_SecObsidian)
  !endif
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ──── Pages ──────────────────────────────────────────────────────
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
