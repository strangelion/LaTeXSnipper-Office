// office_plugin/hosts/WpsAddIn/src/adapters/wps-selection.js
class WpsSelectionAdapter {
  constructor() {
    this.app = window.Application;
  }

  getSelection() {
    return this.app.Selection;
  }

  getRange() {
    return this.getSelection().Range;
  }

  insertText(text) {
    const range = this.getRange();
    range.TypeText(text);
  }

  insertParagraph() {
    const range = this.getRange();
    range.TypeParagraph();
  }

  collapseToEnd() {
    const range = this.getRange();
    range.Collapse(0); // wdCollapseEnd
  }

  collapseToStart() {
    const range = this.getRange();
    range.Collapse(1); // wdCollapseStart
  }

  selectAll() {
    const doc = this.app.ActiveDocument;
    doc.Content.Select();
  }

  getCurrentFontSize() {
    const selection = this.getSelection();
    return selection.Font.Size;
  }

  setCurrentFontSize(size) {
    const selection = this.getSelection();
    selection.Font.Size = size;
  }
}

module.exports = { WpsSelectionAdapter };
