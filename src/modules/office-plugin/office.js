/**
 * Office.js Integration Module
 * Handles communication between Word and LaTeXSnipper app via Office JavaScript API
 */

const OFFICE_API = {
  BASE_URL: 'http://localhost:19876',

  async init() {
    // Check if running inside Office
    if (typeof Office !== 'undefined') {
      Office.onReady((info) => {
        Logger.info(`Office.js ready: ${info.host} ${info.platform}`);
        this.registerFunctions();
      });
    } else {
      Logger.info('Not running inside Office - Office.js features disabled');
    }
  },

  registerFunctions() {
    // Register custom functions for ribbon buttons
    Office.context.document.addHandlerAsync(Office.EventType.DocumentSelectionChanged, () => {
      Logger.debug('Selection changed in Word');
    });
  },

  // Called by ribbon button "Insert Formula"
  async insertFormula() {
    try {
      // Get current formula from app (Tauri invoke or global state)
      const app = window.__app;
      let latex = '';
      if (app && app.editor) {
        latex = app.editor.getLatex();
      }
      if (!latex) {
        latex = 'E=mc^2';
      }

      // Convert LaTeX to OMML via bridge
      const resp = await fetch(`${this.BASE_URL}/api/office/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex })
      });
      const data = await resp.json();

      if (!data.success || !data.omml) {
        Logger.error('Formula conversion failed');
        return;
      }

      // Insert OMML at cursor using Office.js
      await this.insertOMML(data.omml, latex);

    } catch (e) {
      Logger.error('insertFormula error:', e);
    }
  },

  async insertOMML(ommlXml, latex) {
    return new Promise((resolve, reject) => {
      Office.context.document.setSelectedDataAsync(
        { omml: ommlXml },
        { coercionType: 'omml' },
        (result) => {
          if (result.status === Office.AsyncResultStatus.Succeeded) {
            Logger.info('OMML inserted successfully');
            resolve();
          } else {
            Logger.error('OMML insert failed:', result.error);
            reject(result.error);
          }
        }
      );
    });
  },

  // Called by ribbon button "Load Selection"
  async loadSelection() {
    return new Promise((resolve, reject) => {
      Office.context.document.getSelectedDataAsync(
        Office.CoercionType.Omml,
        (result) => {
          if (result.status === Office.AsyncResultStatus.Succeeded) {
            const omml = result.value;
            Logger.info('Selection OMML:', omml);

            // Try to extract LaTeX from OMML (basic reverse)
            const latex = this.ommlToLatex(omml);

            // Send to Tauri app
            const app = window.__app;
            if (app) {
              app.switchSection('editor');
              app.editor.setLatex(latex);
              app.showToast('已加载选中文本');
            }

            resolve(latex);
          } else {
            // Fallback: try plain text
            Office.context.document.getSelectedDataAsync(
              Office.CoercionType.Text,
              (textResult) => {
                if (textResult.status === Office.AsyncResultStatus.Succeeded) {
                  const text = textResult.value;
                  Logger.info('Selection text:', text);
                  const app = window.__app;
                  if (app) {
                    app.switchSection('editor');
                    app.editor.setLatex(text);
                    app.showToast('已加载选中文本');
                  }
                  resolve(text);
                } else {
                  reject(textResult.error);
                }
              }
            );
          }
        }
      );
    });
  },

  ommlToLatex(omml) {
    // Basic OMML to LaTeX conversion
    if (!omml) return '';
    let latex = omml;

    // Extract text content from OMML tags
    latex = latex.replace(/<[^>]+>/g, ' ');
    latex = latex.replace(/\s+/g, ' ').trim();

    return latex;
  },

  // Called by ribbon button "Delete Selection"
  async deleteSelection() {
    return new Promise((resolve) => {
      Office.context.document.setSelectedDataAsync(
        '',
        { coercionType: 'text' },
        (result) => {
          if (result.status === Office.AsyncResultStatus.Succeeded) {
            Logger.info('Selection deleted');
          }
          resolve();
        }
      );
    });
  },

  // Render formula to OMML via bridge and insert
  async renderAndInsert(latex, display = false) {
    try {
      const resp = await fetch(`${this.BASE_URL}/api/office/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latex, display })
      });
      const data = await resp.json();

      if (data.success && data.omml) {
        await this.insertOMML(data.omml, latex);
        return true;
      }
      return false;
    } catch (e) {
      Logger.error('renderAndInsert error:', e);
      return false;
    }
  }
};

// Register global functions for Office.js ExecuteFunction
window.insertFormula = () => OFFICE_API.insertFormula();
window.loadSelection = () => OFFICE_API.loadSelection();
window.deleteSelection = () => OFFICE_API.deleteSelection();

// Make available globally
window.OFFICE_API = OFFICE_API;

export default OFFICE_API;
