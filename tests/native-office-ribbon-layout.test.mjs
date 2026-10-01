import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");
const nativeRoot = path.join("apps", "native-office");

const ribbonFiles = [
  ["LaTeXSnipper.Word", "Ribbon", "LaTeXSnipperRibbon.xml"],
  ["LaTeXSnipper.Excel", "Ribbon", "ExcelRibbon.xml"],
  ["LaTeXSnipper.PowerPoint", "Ribbon", "PowerPointRibbon.xml"],
  ["LaTeXSnipper.Visio", "Ribbon", "VisioRibbon.xml"],
];

test("Native Office ribbons keep all commands visible in compact task groups", () => {
  for (const parts of ribbonFiles) {
    const xml = read(nativeRoot, ...parts);
    const groupPositions = ["FormulaGroup", "EditGroup", "ToolsGroup"].map(
      (id) => xml.indexOf(`id="${id}"`),
    );
    assert.ok(groupPositions.every((position) => position >= 0));
    assert.deepEqual(
      groupPositions,
      [...groupPositions].sort((a, b) => a - b),
    );
    for (const id of [
      "btnOcrSelector",
      "btnLoadSelected",
      "btnDeleteSelected",
      "btnShowTaskPane",
      "btnFormulaLibrary",
      "btnDrawingWorkspace",
      "btnRecognitionWorkspace",
      "btnFormulaConvert",
      "btnBatchConvert",
      "btnOfficeWorkspace",
      "btnDiagnostics",
      "btnSettings",
      "btnHelp",
    ]) {
      assert.equal(xml.match(new RegExp(`id="${id}"`, "g"))?.length, 1);
    }
    assert.match(xml, /id="btnLoadSelected"[^>]+size="large"/);
    assert.match(xml, /id="btnShowTaskPane"[^>]+size="large"/);
    assert.match(xml, /id="btnBatchConvert"[^>]+size="large"/);
    assert.match(xml, /id="WorkspaceActionsBox" boxStyle="vertical"/);
    assert.match(xml, /id="DocumentActionsBox" boxStyle="vertical"/);
    assert.match(xml, /id="btnSettings"[^>]+keytip="S"/);
    assert.match(xml, /id="btnHelp"[^>]+keytip="H"/);
  }

  const word = read(nativeRoot, ...ribbonFiles[0]);
  assert.match(word, /id="btnInsertDisplay"[^>]+size="large"/);
  assert.match(word, /id="InsertVariantsBox" boxStyle="vertical"/);
  assert.match(word, /id="btnInsertInline"[^>]+tag="insertInline"/);
  assert.match(word, /id="btnInsertNumbered"[^>]+tag="insertNumbered"/);
});

test("Excel and PowerPoint selection commands open revision-aware edit transactions", () => {
  for (const [host, project, file] of [
    ["excel", "LaTeXSnipper.Excel", "ExcelRibbonExtensibility.cs"],
    [
      "powerpoint",
      "LaTeXSnipper.PowerPoint",
      "PowerPointRibbonExtensibility.cs",
    ],
  ]) {
    const source = read(nativeRoot, project, "Ribbon", file);
    assert.match(source, /case "readSelection"/);
    assert.match(source, /addIn\.Send\(new VstoOpenEditor/);
    assert.match(source, /Action = "edit"/);
    assert.match(source, /FormulaId = f\.FormulaId/);
    assert.match(source, /Revision = f\.Revision/);
    assert.match(source, new RegExp(`SourceHost = "${host}"`));
    assert.doesNotMatch(source, /ReadFormulaPrefix\) \+ f\.Latex/);
    assert.match(source, /case "workspaceLibrary"/);
    assert.match(source, /case "workspaceConversion"/);
    assert.match(source, /case "workspaceBatch"/);
    assert.match(source, /Action = "workspace"/);
    assert.match(source, /Workspace = WorkspaceFromTag/);
  }
});

test("Ribbon labels describe creation, selection, and workspace workflows", () => {
  const localizer = read(
    nativeRoot,
    "LaTeXSnipper.Shared",
    "RibbonLocalizer.cs",
  );
  for (const label of [
    '["FormulaGroup"] = "创建"',
    '["EditGroup"] = "选中公式"',
    '["WorkspaceGroup"] = "功能工作区"',
    '["ToolsGroup"] = "转换与工具"',
    '["btnLoadSelected"] = "编辑选中公式"',
    '["btnShowTaskPane"] = "打开工作区"',
    '["btnFormulaConvert"] = "公式转换"',
    '["btnBatchConvert"] = "批量转换"',
  ]) {
    assert.match(
      localizer,
      new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
});
