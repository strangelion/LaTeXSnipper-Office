#!/usr/bin/env python3
"""Clone Zotero.dotm and replace customUI.xml"""
import os, zipfile, shutil

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "out")
DOTM_PATH = os.path.join(OUT_DIR, "LaTeXSnipper.dotm")
ZOTERO = r"C:\Program Files\Zotero\integration\word-for-windows\Zotero.dotm"
CUI = open(os.path.join(SCRIPT_DIR, "customUI.xml"), "r", encoding="utf-8").read()

os.makedirs(OUT_DIR, exist_ok=True)
if not os.path.exists(ZOTERO):
    print(f"ERROR: {ZOTERO} not found")
    exit(1)

print(f"Source: {ZOTERO}")
temp_dir = os.path.join(OUT_DIR, "_temp")
if os.path.exists(temp_dir):
    shutil.rmtree(temp_dir)

with zipfile.ZipFile(ZOTERO, 'r') as zin:
    zin.extractall(temp_dir)

cui_path = os.path.join(temp_dir, "customUI", "customUI.xml")
os.makedirs(os.path.dirname(cui_path), exist_ok=True)
with open(cui_path, "w", encoding="utf-8") as f:
    f.write(CUI)

with zipfile.ZipFile(DOTM_PATH, 'w', zipfile.ZIP_DEFLATED) as zout:
    for root, dirs, files in os.walk(temp_dir):
        for fn in files:
            fp = os.path.join(root, fn)
            zout.write(fp, os.path.relpath(fp, temp_dir))

shutil.rmtree(temp_dir)
shutil.copy(DOTM_PATH, os.path.expandvars(r"%APPDATA%\Microsoft\Word\STARTUP\LaTeXSnipper.dotm"))
print(f"Created: {DOTM_PATH} ({os.path.getsize(DOTM_PATH)} bytes)")
print("Copied to Word STARTUP folder")
