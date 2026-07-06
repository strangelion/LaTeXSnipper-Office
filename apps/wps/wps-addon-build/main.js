// LaTeXSnipper WPS Plugin - Main Entry
// Note: WPS auto-creates index.html, developers should NOT create it

// Global variables
let taskpane = null;
let bridgeConnected = false;

/**
 * Called when WPS loads this add-in (from ribbon.xml onLoad)
 */
function OnAddInLoad(wpsApplication) {
    console.log('LaTeXSnipper WPS Plugin loaded');
    
    // Register event handlers
    if (wpsApplication) {
        wpsApplication.DocumentOpen = function() {
            console.log('Document opened');
        };
        
        wpsApplication.DocumentBeforeClose = function() {
            console.log('Document closing');
        };
    }
    
    // Test bridge connection
    testBridgeConnection();
}

/**
 * Insert formula as OMML
 */
function OnInsertFormula() {
    const latex = getSelectedLatex();
    if (!latex) {
        alert('请先在任务窗格中输入 LaTeX 公式');
        return;
    }
    
    insertFormulaToDocument(latex, 'omml');
}

/**
 * Insert formula as image
 */
function OnInsertImage() {
    const latex = getSelectedLatex();
    if (!latex) {
        alert('请先在任务窗格中输入 LaTeX 公式');
        return;
    }
    
    insertFormulaToDocument(latex, 'png');
}

/**
 * Manage formulas
 */
function OnManageFormulas() {
    showTaskPane();
}

/**
 * Open settings
 */
function OnSettings() {
    showTaskPane();
}

/**
 * Get insert formula icon
 */
function GetInsertFormulaIcon() {
    // Return icon path or base64
    return 'assets/icons/formula.png';
}

/**
 * Get insert image icon
 */
function GetInsertImageIcon() {
    return 'assets/icons/image.png';
}

/**
 * Get manage icon
 */
function GetManageIcon() {
    return 'assets/icons/manage.png';
}

/**
 * Get settings icon
 */
function GetSettingsIcon() {
    return 'assets/icons/settings.png';
}

/**
 * Show or create task pane
 */
function showTaskPane() {
    if (!taskpane) {
        // Create task pane with URL to taskpane.html
        // WPS will serve this file from the plugin directory
        taskpane = wps.WpsApplication().CreateTaskPane('LaTeXSnipper');
        taskpane.Navigate('taskpane.html');
        taskpane.Visible = true;
    } else {
        taskpane.Visible = true;
    }
}

/**
 * Test Bridge connection
 */
function testBridgeConnection() {
    fetch('http://127.0.0.1:28765/config')
        .then(response => response.json())
        .then(data => {
            bridgeConnected = true;
            console.log('Bridge connected:', data);
        })
        .catch(error => {
            bridgeConnected = false;
            console.warn('Bridge not available:', error);
        });
}

/**
 * Get selected LaTeX from editor
 */
function getSelectedLatex() {
    // This will be called from task pane
    // For now, return empty string
    return '';
}

/**
 * Insert formula to document
 */
async function insertFormulaToDocument(latex, type) {
    try {
        // Convert LaTeX via Bridge
        const response = await fetch('http://127.0.0.1:28765/convert/latex', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                latex: latex,
                display: true,
                targets: [type]
            })
        });
        
        const result = await response.json();
        
        if (result.ok) {
            if (type === 'omml' && result.result.omml) {
                insertOMML(result.result.omml);
            } else if (type === 'png' && result.result.png_base64) {
                insertImage(result.result.png_base64);
            }
        } else {
            alert('公式转换失败: ' + result.error.message);
        }
    } catch (error) {
        alert('插入公式失败: ' + error.message);
    }
}

/**
 * Insert OMML to document
 */
function insertOMML(ommlXml) {
    const app = wps.WpsApplication();
    const doc = app.ActiveDocument;
    const selection = app.Selection;
    
    // Insert OMML XML
    selection.Range.InsertXML(ommlXml);
}

/**
 * Insert image to document
 */
function insertImage(base64Data) {
    const app = wps.WpsApplication();
    const selection = app.Selection;
    
    // Save temp image file
    const tempPath = saveTempImage(base64Data);
    
    // Insert image
    selection.InlineShapes.AddPicture(tempPath, false, true);
    
    // Delete temp file
    deleteTempFile(tempPath);
}

/**
 * Save temp image file
 */
function saveTempImage(base64Data) {
    const fs = wps.FileSystem;
    const tempDir = wps.GetTempPath();
    const fileName = 'latex_formula_' + Date.now() + '.png';
    const filePath = tempDir + '\\' + fileName;
    
    // Convert base64 to file
    const file = fs.OpenTextFile(filePath, 2, true);
    file.Write(atob(base64Data));
    file.Close();
    
    return filePath;
}

/**
 * Delete temp file
 */
function deleteTempFile(filePath) {
    try {
        wps.FileSystem.DeleteFile(filePath);
    } catch (error) {
        console.warn('Failed to delete temp file:', error);
    }
}
