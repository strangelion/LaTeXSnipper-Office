// LaTeXSnipper WPS Plugin - Main Entry
// Note: WPS auto-creates index.html, developers should NOT create it

// Global variables
var taskpane = null;
var bridgeConnected = false;
var bridgeUrl = "http://127.0.0.1:28765";
var bridgeToken = "";

/**
 * Called when WPS loads this add-in (from ribbon.xml onLoad)
 */
function OnAddinLoad(wpsApplication) {
    console.log("LaTeXSnipper WPS Plugin loaded");
    testBridgeConnection();
}

/**
 * Test connection to LaTeXSnipper Bridge
 */
function testBridgeConnection() {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", bridgeUrl + "/health", true);
    xhr.timeout = 3000;
    xhr.onload = function() {
        if (xhr.status === 200) {
            bridgeConnected = true;
            console.log("Bridge connected");
            getConfig();
        }
    };
    xhr.onerror = function() {
        bridgeConnected = false;
        console.log("Bridge not available");
    };
    xhr.send();
}

/**
 * Get Bridge config and token
 */
function getConfig() {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", bridgeUrl + "/config", true);
    xhr.timeout = 3000;
    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                var config = JSON.parse(xhr.responseText);
                bridgeToken = config.token || "";
                bridgeUrl = config.bridge_url || bridgeUrl;
                console.log("Bridge configured");
            } catch(e) {
                console.log("Config parse error");
            }
        }
    };
    xhr.send();
}

/**
 * Convert LaTeX to specified target format
 */
function convertLatex(latex, target, callback) {
    if (!bridgeConnected) {
        alert("Cannot connect to LaTeXSnipper. Please start the desktop client.");
        return;
    }
    
    var xhr = new XMLHttpRequest();
    xhr.open("POST", bridgeUrl + "/convert/latex", true);
    xhr.timeout = 30000;
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Authorization", "Bearer " + bridgeToken);
    
    var payload = JSON.stringify({
        latex: latex,
        display: true,
        targets: [target]
    });
    
    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                var result = JSON.parse(xhr.responseText);
                if (result.ok) {
                    callback(result.result);
                } else {
                    alert("Conversion failed: " + (result.error ? result.error.message : "Unknown error"));
                }
            } catch(e) {
                alert("Response parse error");
            }
        } else {
            alert("Bridge request failed");
        }
    };
    
    xhr.onerror = function() {
        alert("Cannot connect to LaTeXSnipper Bridge");
    };
    
    xhr.send(payload);
}

/**
 * Insert formula as OMML into document
 */
function OnInsertFormula() {
    var doc = wps.WpsApplication().ActiveDocument;
    if (!doc) {
        alert("Please open a document first");
        return;
    }
    
    var latex = wps.PluginStorage.getItem("current_latex");
    if (!latex) {
        alert("Please input a LaTeX formula in the task pane first");
        return;
    }
    
    convertLatex(latex, "omml", function(result) {
        if (result && result.omml) {
            insertOmlToDocument(result.omml);
        }
    });
}

/**
 * Insert formula as image into document
 */
function OnInsertImage() {
    var doc = wps.WpsApplication().ActiveDocument;
    if (!doc) {
        alert("Please open a document first");
        return;
    }
    
    var latex = wps.PluginStorage.getItem("current_latex");
    if (!latex) {
        alert("Please input a LaTeX formula in the task pane first");
        return;
    }
    
    convertLatex(latex, "png", function(result) {
        if (result && result.png_base64) {
            insertImageToDocument(result.png_base64);
        }
    });
}

/**
 * Insert OMML content into document
 */
function insertOmlToDocument(omml) {
    var doc = wps.WpsApplication().ActiveDocument;
    var selection = wps.WpsApplication().Selection;
    
    // Type the OMML XML
    selection.TypeText(omml);
    
    // Select the typed text
    var startPos = selection.Range.End - omml.length;
    var endPos = selection.Range.End;
    var range = doc.Range(startPos, endPos);
    range.Select();
    
    // Convert to equation
    selection.OMaths.Add(selection.Range);
    if (selection.OMaths.Count > 0) {
        var oMath = selection.OMaths.Item(1);
        try { oMath.BuildUp(); } catch(e) {}
    }
}

/**
 * Insert base64 image into document
 */
function insertImageToDocument(base64) {
    var doc = wps.WpsApplication().ActiveDocument;
    var selection = wps.WpsApplication().Selection;
    
    // Save base64 to temp file
    var tempPath = wps.Env.GetTempPath() + "\\latexsnipper_formula.png";
    
    // Decode base64 and save
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    
    // Write as binary string
    var binaryStr = "";
    for (var i = 0; i < bytes.length; i++) {
        binaryStr += String.fromCharCode(bytes[i]);
    }
    wps.FileSystem.writeAsBinaryString(tempPath, binaryStr);
    
    // Insert image
    selection.InlineShapes.AddPicture(tempPath, false, true);
    
    // Clean up temp file
    try { wps.FileSystem.Remove(tempPath); } catch(e) {}
}

/**
 * Show task pane
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
 * Show or create task pane
 */
function showTaskPane() {
    var tsId = wps.PluginStorage.getItem("taskpane_id");
    if (!tsId) {
        var url = getPluginUrl() + "/ui/taskpane.html";
        var tskpane = wps.CreateTaskPane(url);
        wps.PluginStorage.setItem("taskpane_id", tskpane.ID);
        tskpane.Visible = true;
    } else {
        var tskpane = wps.GetTaskPane(tsId);
        tskpane.Visible = !tskpane.Visible;
    }
}

/**
 * Get plugin URL path
 */
function getPluginUrl() {
    var url = document.location.toString();
    url = decodeURI(url);
    if (url.indexOf("/") !== -1) {
        url = url.substring(0, url.lastIndexOf("/"));
    }
    return url;
}

/**
 * Screenshot OCR - placeholder
 */
function OnScreenshotOcr() {
    alert("Screenshot OCR feature is under development");
}

/**
 * Load selected formula - placeholder
 */
function OnLoadSelected() {
    alert("Load selected formula feature is under development");
}

/**
 * Delete selected formula - placeholder
 */
function OnDeleteSelected() {
    alert("Delete selected formula feature is under development");
}

/**
 * Auto number formulas - placeholder
 */
function OnAutoNumber() {
    alert("Auto number feature is under development");
}

/**
 * Renumber all formulas - placeholder
 */
function OnRenumber() {
    alert("Renumber feature is under development");
}

/**
 * Show help
 */
function OnHelp() {
    window.open("https://latexsnipper.readthedocs.io/", "_blank");
}

/**
 * Get image for button
 */
function GetInsertFormulaIcon() {
    return getPluginUrl() + "/images/insert_inline.svg";
}

function GetInsertImageIcon() {
    return getPluginUrl() + "/images/insert_display.svg";
}

function GetManageIcon() {
    return getPluginUrl() + "/images/settings.svg";
}

function GetSettingsIcon() {
    return getPluginUrl() + "/images/settings.svg";
}
