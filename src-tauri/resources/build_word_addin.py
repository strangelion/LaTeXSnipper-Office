#!/usr/bin/env python3
"""Create LaTeXSnipper.dotm from scratch using Word COM automation.
No external template required — only needs Word installed.

Strategy: .docm (Word creates vbaProject.bin) → rename to .dotm → inject customUI.xml
"""
import os
import sys
import time
import zipfile
import shutil
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "out")
DOCX_PATH = os.path.join(OUT_DIR, "LaTeXSnipper.docm")
DOTM_PATH = os.path.join(OUT_DIR, "LaTeXSnipper.dotm")
NO_INSTALL = "--no-install" in sys.argv

os.makedirs(OUT_DIR, exist_ok=True)

try:
    import win32com.client
except ImportError:
    print("ERROR: pywin32 not found")
    print("  Try: python -m pip install pywin32")
    sys.exit(1)

# ── Step 1: Create .docm with VBA via Word COM ─────────────────────

print("[1/3] Creating .docm with VBA modules via Word COM...")

vba_dir = os.path.join(SCRIPT_DIR, "vba")
bas_files = sorted(f for f in os.listdir(vba_dir) if f.endswith(".bas"))

word = win32com.client.Dispatch("Word.Application")
word.Visible = False
word.DisplayAlerts = 0

try:
    doc = word.Documents.Add()
    vb = doc.VBProject

    for bas_file in bas_files:
        bas_path = os.path.join(vba_dir, bas_file)
        module_name = os.path.splitext(bas_file)[0]
        with open(bas_path, "r", encoding="utf-8") as f:
            code = f.read()

        mod = vb.VBComponents.Add(1)  # 1 = vbext_ct_StdModule
        mod.Name = module_name
        mod.CodeModule.AddFromString(code)
        print(f"  + {module_name}.bas ({len(code)} chars)")

    doc.SaveAs2(DOCX_PATH, FileFormat=13)  # 13 = wdFormatXMLDocumentMacroEnabled
    doc.Close(0)
    print(f"  Saved .docm: {DOCX_PATH}")
finally:
    word.Quit()
    time.sleep(1)

# ── Step 2: Convert .docm → .dotm + inject customUI.xml ────────────

print("[2/3] Converting .docm → .dotm + injecting customUI.xml...")

# Copy .docm as .dotm
shutil.copy2(DOCX_PATH, DOTM_PATH)

# Inject customUI.xml via ZIP manipulation
customui_src = os.path.join(SCRIPT_DIR, "customUI.xml")
if not os.path.exists(customui_src):
    print(f"  WARNING: {customui_src} not found, skipping customUI")
else:
    with open(customui_src, "r", encoding="utf-8") as f:
        customui_content = f.read()

    temp_dir = tempfile.mkdtemp(prefix="dotm_build_")
    try:
        with zipfile.ZipFile(DOTM_PATH, "r") as zin:
            zin.extractall(temp_dir)

        # Write customUI.xml
        cui_path = os.path.join(temp_dir, "customUI", "customUI.xml")
        os.makedirs(os.path.dirname(cui_path), exist_ok=True)
        with open(cui_path, "w", encoding="utf-8") as f:
            f.write(customui_content)

        # Add customUI relationships
        cui_rels_dir = os.path.join(temp_dir, "customUI", "_rels")
        os.makedirs(cui_rels_dir, exist_ok=True)
        with open(os.path.join(cui_rels_dir, "customUI.xml.rels"), "w", encoding="utf-8") as f:
            f.write("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2006/relationships/uiExtensibility" Target="vbaProject.bin"/>
</Relationships>""")

        # Add customUI to [Content_Types].xml
        ct_path = os.path.join(temp_dir, "[Content_Types].xml")
        if os.path.exists(ct_path):
            with open(ct_path, "r", encoding="utf-8") as f:
                ct = f.read()
            if "/customUI/customUI.xml" not in ct:
                ct = ct.replace("</Types>",
                    '  <Override PartName="/customUI/customUI.xml" ContentType="application/xml"/>\n</Types>')
                with open(ct_path, "w", encoding="utf-8") as f:
                    f.write(ct)

        # Rewrite ZIP (preserve binary files as-is)
        with zipfile.ZipFile(DOTM_PATH, "w", zipfile.ZIP_DEFLATED) as zout:
            for root, dirs, files in os.walk(temp_dir):
                for fn in files:
                    fp = os.path.join(root, fn)
                    arcname = os.path.relpath(fp, temp_dir)
                    if fn.endswith('.bin') or fn.endswith('.png'):
                        with open(fp, "rb") as f:
                            data = f.read()
                        zout.writestr(arcname, data)
                    else:
                        zout.write(fp, arcname)

        print(f"  customUI.xml injected → {DOTM_PATH}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

# ── Step 3: Install to STARTUP ──────────────────────────────────────

if not NO_INSTALL:
    print("[3/3] Installing to Word STARTUP...")
    startup = os.path.join(os.environ["APPDATA"], "Microsoft", "Word", "STARTUP")
    os.makedirs(startup, exist_ok=True)
    dest = os.path.join(startup, "LaTeXSnipper.dotm")
    shutil.copy2(DOTM_PATH, dest)
    print(f"  Installed: {dest}")
    print("  Restart Word to load the updated add-in.", flush=True)
else:
    print("[3/3] Skipped install (--no-install)")
    print(f"  Built: {DOTM_PATH}", flush=True)

# ── Verify ──────────────────────────────────────────────────────────

with zipfile.ZipFile(DOTM_PATH, "r") as z:
    has_vba = "word/vbaProject.bin" in z.namelist()
    has_customui = "customUI/customUI.xml" in z.namelist()
    vba_size = z.getinfo("word/vbaProject.bin").file_size if has_vba else 0
    print(f"\n  vbaProject.bin: {'OK (' + str(vba_size) + ' bytes)' if has_vba else 'MISSING'}")
    print(f"  customUI.xml:   {'OK' if has_customui else 'MISSING'}")
