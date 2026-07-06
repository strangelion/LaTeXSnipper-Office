// office_plugin/hosts/WpsAddIn/src/adapters/wps-document.js
class WpsDocumentAdapter {
  constructor() {
    this.app = window.Application;
  }

  getDocument() {
    return this.app.ActiveDocument;
  }

  getSelection() {
    return this.app.Selection;
  }

  async insertOMML(ommlXml) {
    const selection = this.getSelection();
    selection.Range.InsertXML(ommlXml);
  }

  async insertImage(imageBase64) {
    const selection = this.getSelection();
    const tempPath = await this.saveTempImage(imageBase64);
    selection.InlineShapes.AddPicture(tempPath, false, true);
    await this.deleteTempFile(tempPath);
  }

  async saveTempImage(base64Data) {
    const tempDir = this.app.PathTemp;
    const fileName = `latex_formula_${Date.now()}.png`;
    const filePath = `${tempDir}\\${fileName}`;

    const response = await fetch(`data:image/png;base64,${base64Data}`);
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const file = this.app.FileSystem.OpenTextFile(filePath, 2, true);
    file.Write(uint8Array);
    file.Close();

    return filePath;
  }

  async deleteTempFile(filePath) {
    try {
      this.app.FileSystem.DeleteFile(filePath);
    } catch (error) {
      console.warn('Failed to delete temp file:', error);
    }
  }

  async loadFormula(contentControl) {
    const metadata = {
      equationId: contentControl.Tag,
      latex: contentControl.Range.Text,
      display: true
    };
    return metadata;
  }

  async updateFormula(contentControl, newOoml) {
    contentControl.Range.InsertXML(newOoml);
  }

  async deleteFormula(contentControl) {
    contentControl.Delete();
  }

  async renumberFormulas(mode = 'automatic') {
    const doc = this.getDocument();
    const contentControls = doc.ContentControls;

    let counter = 1;
    for (let i = 1; i <= contentControls.Count; i++) {
      const cc = contentControls.Item(i);
      if (cc.Tag && cc.Tag.startsWith('latexsnipper-eq-')) {
        if (mode === 'automatic') {
          const equationId = cc.Tag.replace('latexsnipper-eq-', '');
          const numberTag = `latexsnipper-eqn-${equationId}`;
          for (let j = 1; j <= contentControls.Count; j++) {
            const numberCc = contentControls.Item(j);
            if (numberCc.Tag === numberTag) {
              numberCc.Range.Text = `[${counter}]`;
              break;
            }
          }
          counter++;
        }
      }
    }

    return counter - 1;
  }
}

module.exports = { WpsDocumentAdapter };
