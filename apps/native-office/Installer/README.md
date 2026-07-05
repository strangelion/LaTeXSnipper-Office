# LaTeXSnipper Native Office Installer

## Overview

This directory contains the WiX-based installer for LaTeXSnipper Native Office VSTO Add-in.

## Components

| File | Purpose |
|------|---------|
| `WiX/LaTeXSnipper.NativeOffice.wxs` | Main MSI installer definition |
| `WiX/Bundle.wxs` | Bootstrapper (checks .NET 4.8 + VSTO Runtime) |
| `build.ps1` | Build script (compiles solution + creates MSI + Bundle) |
| `sign.ps1` | Code signing script (signs MSI, EXE, and DLLs) |
| `migrate.ps1` | Old plugin detection and migration |

## Prerequisites

- Windows 10/11
- .NET Framework 4.8 SDK
- WiX Toolset v4+ (`wix` CLI)
- Visual Studio 2022 with VSTO workload
- Code signing certificate (for production builds)

## Build

```powershell
# From apps/native-office/Installer/
.\build.ps1 -Configuration Release
```

Output:
- `output/LaTeXSnipper.NativeOffice.msi` — MSI installer
- `output/LaTeXSnipper.NativeOffice.exe` — Bootstrapper EXE

## Sign

```powershell
# Using first available code signing certificate
.\sign.ps1

# Using specific certificate
.\sign.ps1 -CertThumbprint "ABC123..."
```

## Migrate

```powershell
# Preview what will be migrated
.\migrate.ps1 -DryRun

# Perform migration
.\migrate.ps1 -Force
```

## Installation

1. Run `LaTeXSnipper.NativeOffice.exe` (bootstrapper)
2. Bootstrapper checks for:
   - .NET Framework 4.8 (downloads if missing)
   - VSTO Runtime (downloads if missing)
3. MSI installs VSTO add-ins to:
   - `%LOCALAPPDATA%\LaTeXSnipper\NativeOffice\Word\`
   - `%LOCALAPPDATA%\LaTeXSnipper\NativeOffice\Excel\`
   - `%LOCALAPPDATA%\LaTeXSnipper\NativeOffice\PowerPoint\`
4. Registry entries created under HKCU for each host
5. Restart Word/Excel/PowerPoint to load add-ins

## Uninstallation

1. Windows Settings → Apps → LaTeXSnipper Native Office → Uninstall
2. Or run: `msiexec /x LaTeXSnipper.NativeOffice.msi`

## Registry Structure

```
HKCU\Software\Microsoft\Office\Word\Addins\LaTeXSnipper.NativeOffice.Word
  FriendlyName = "LaTeXSnipper Native Office — Word"
  Description  = "LaTeX formula and table integration for Word"
  LoadBehavior = 3 (load at startup)
  Manifest     = "file:///.../Word/LaTeXSnipper.NativeOffice.Word.vsto|vstolocal"

HKCU\Software\Microsoft\Office\Excel\Addins\LaTeXSnipper.NativeOffice.Excel
  ...

HKCU\Software\Microsoft\Office\PowerPoint\Addins\LaTeXSnipper.NativeOffice.PowerPoint
  ...
```
