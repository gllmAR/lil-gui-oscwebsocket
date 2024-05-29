import { GUI } from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19.2/+esm';

export function initializeWebSocket() {
    const oscScript = document.createElement('script');
    oscScript.src = 'https://cdn.jsdelivr.net/npm/osc/dist/osc-browser.min.js';
    document.head.appendChild(oscScript);

    oscScript.onload = () => {
        WebSocketPort = osc.WebSocketPort;
        if (WebSocketPort) {
            const params = getSettingsParams();
            if (params.lil_gui_oscws.value.websocket.value.autoConnect.value) {
                logDebug('Auto-connect enabled. Attempting to connect WebSocket...');
                connectWebSocket(params);
            }
        } else {
            logError('WebSocketPort is not defined after loading osc.js.');
        }
    };
}

let oscPort = null;
let reconnectInterval = null;
let guiVisible = true;
let gui, controls = {};
let debugLogEnabled = false;
const showButton = document.createElement('div');
let initialParams = {};
let WebSocketPort = null;

function setupShowButton() {
    showButton.id = 'showButton';
    showButton.innerText = '...';
    showButton.style.position = 'fixed';
    showButton.style.top = '5px';
    showButton.style.right = '5px';
    showButton.style.padding = '5px 10px';
    showButton.style.borderRadius =  "5px"
    showButton.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    showButton.style.color = 'white';
    showButton.style.border = '1px dotted white';
    showButton.style.cursor = 'pointer';
    showButton.style.transition = 'opacity 2s';
    showButton.style.opacity = '0';
    showButton.style.pointerEvents = 'none';
    showButton.onclick = toggleGUIVisibility;
    document.body.appendChild(showButton);
}

function determineOSCTypes(value) {
    if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            return { type: 'i', value: value }; // integer
        } else {
            return { type: 'f', value: value }; // float
        }
    } else if (typeof value === 'string') {
        return { type: 's', value: value }; // string
    } else if (typeof value === 'boolean') {
        return { type: 'i', value: value ? 1 : 0 }; // boolean as integer (1 or 0)
    } else {
        return { type: 's', value: JSON.stringify(value) }; // other types as JSON string
    }
}

function sendOSCMessage(parameter, value) {
    if (oscPort && oscPort.socket && oscPort.socket.readyState === WebSocket.OPEN) {
        if (value !== undefined && value !== null) {
            const oscArg = determineOSCTypes(value);
            const message = {
                address: parameter,
                args: [oscArg] // Ensure correct OSC message format
            };

            logDebug(`Attempting to send OSC message: ${JSON.stringify(message)}`);
            
            try {
                oscPort.send(message);
                logDebug(`Sent OSC message: ${parameter} - ${oscArg.value}`);
            } catch (error) {
                logError(`Error sending OSC message for ${parameter}: ${error.message}`);
                logError(error.stack);
            }
        } else {
            logDebug(`Skipping undefined or null value for parameter: ${parameter}`);
        }
    } else {
        logDebug(`WebSocket not open. Cannot send message for parameter: ${parameter}`);
    }
}

function updateParameter(obj, path, value) {
    const key = path.shift();
    if (path.length === 0) {
        obj[key].value = value;
        if (obj[key].onUpdate) obj[key].onUpdate(value);
    } else {
        updateParameter(obj[key].value, path, value);
    }
}

function handlePortUpdate(params) {
    if (params && params.lil_gui_oscws && params.lil_gui_oscws.value.websocket.value.status.value === 'Connected') {
        disconnectWebSocket(params);
        connectWebSocket(params);
    }
}

function handleDebugLogToggle(params) {
    if (params){
        debugLogEnabled = params;
        logDebug('Debug logging', debugLogEnabled ? 'enabled' : 'disabled');
    } 
}

function handleAutoReconnectToggle(params) {
    if (params && params.lil_gui_oscws) {
        console.log("here")
        if (params.lil_gui_oscws.value.websocket.value.autoReconnect.value) {
            if (params.lil_gui_oscws.value.websocket.value.status.value === 'Disconnected') {
                startAutoReconnect(params);
            }
        } else {
            stopAutoReconnect();
        }
    }
}

function logDebug(...args) {
    if (debugLogEnabled) {
        console.log(...args);
    }
}

function logError(...args) {
    if (debugLogEnabled) {
        console.error(...args);
    }
}

function startAutoReconnect(params) {
    if (!reconnectInterval) {
        reconnectInterval = setInterval(() => {
            if (params.lil_gui_oscws.value.websocket.value.status.value === 'Disconnected') {
                logDebug('Attempting to reconnect WebSocket...');
                connectWebSocket(params);
            }
        }, 1000); 
    }
}

function stopAutoReconnect() {
    if (reconnectInterval) {
        clearInterval(reconnectInterval);
        reconnectInterval = null;
    }
}

export function toggleGUIVisibility() {
    guiVisible = !guiVisible;
    gui.domElement.style.display = guiVisible ? 'block' : 'none';
    showButton.style.opacity = guiVisible ? '0' : '1';
    showButton.style.pointerEvents = guiVisible ? 'none' : 'auto';
    if (!guiVisible) {
        setTimeout(() => {
            showButton.style.opacity = '0';
            showButton.style.pointerEvents = 'auto';
        }, 2000);
    }
}

export function connectWebSocket(params) {
    if (oscPort) {
        oscPort.close();
    }
    if (!WebSocketPort) {
        logError('WebSocketPort is not defined. Ensure osc.js library is loaded.');
        return;
    }
    oscPort = new WebSocketPort({
        url: `ws://${params.lil_gui_oscws.value.websocket.value.address.value}:${params.lil_gui_oscws.value.websocket.value.port.value}`
    });

    oscPort.open();

    oscPort.on("open", function () {
        params.lil_gui_oscws.value.websocket.value.status.value = 'Connected';
        logDebug('WebSocket connected');
        stopAutoReconnect();
    });

    oscPort.on("close", function () {
        params.lil_gui_oscws.value.websocket.value.status.value = 'Disconnected';
        logDebug('WebSocket disconnected');
        if (params.lil_gui_oscws.value.websocket.value.autoReconnect.value) {
            startAutoReconnect(params);
        }
    });

    oscPort.on("message", function (oscMsg) {
        logDebug("An OSC message just arrived!", oscMsg);
        const { address, args } = oscMsg;
        if (args && args.length > 0) {
            const value = args[0];
            if (controls[address]) {
                updateParameter(params, address.split('/').slice(1), value);
                controls[address].setValue(value).updateDisplay();
                if (controls[address].__onUpdate) controls[address].__onUpdate(value);
            } else {
                logDebug(`Unknown address: ${address}`);
            }
        } else {
            logDebug("Received OSC message with no arguments.");
        }
    });
}

export function disconnectWebSocket(params) {
    if (oscPort) {
        oscPort.close();
    }
    params.lil_gui_oscws.value.websocket.value.status.value = 'Disconnected';
    logDebug('WebSocket disconnected');
    stopAutoReconnect();
}

export function initializeGUI(appParams) {
    gui = new GUI({ autoPlace: false });
    document.body.appendChild(gui.domElement);
    gui.domElement.style.position = 'fixed';
    gui.domElement.style.top = '10px';
    gui.domElement.style.right = '10px';
    gui.domElement.style.maxHeight = '90vh';
    gui.domElement.style.overflowY = 'auto';
    gui.domElement.style.zIndex = '1000';

    setupShowButton(); // Set up the show button

    const settingsParams = getSettingsParams();
    const params = { ...settingsParams, ...appParams };

    function createGUIControls(folder, obj, path) {
        for (const key in obj) {
            const param = obj[key];
            if (param.type === 'folder') {
                const subFolder = folder.addFolder(key);
                subFolder.close();
                createGUIControls(subFolder, param.value, `${path}/${key}`);
            } else {
                const control = createControl(folder, param, key, path, params);
                controls[`${path}/${key}`] = control;
            }
        }
    }

    function createControl(folder, param, key, path, params) {
        let control;
        if (param.type === 'boolean') {
            control = folder.add(param, 'value').name(key).onChange(value => {
                sendOSCMessage(`${path}/${key}`, value);
                if (param.onUpdate) param.onUpdate(value);
            });
        } else if (param.type === 'number') {
            control = folder.add(param, 'value', param.min, param.max, param.step).name(key).onChange(value => {
                sendOSCMessage(`${path}/${key}`, value);
                if (param.onUpdate) param.onUpdate(value);
            });
        } else if (param.type === 'color') {
            control = folder.addColor(param, 'value').name(key).onChange(value => {
                sendOSCMessage(`${path}/${key}`, value);
                if (param.onUpdate) param.onUpdate(value);
            });
        } else if (param.type === 'string') {
            control = folder.add(param, 'value').name(key).onChange(value => {
                sendOSCMessage(`${path}/${key}`, value);
                if (param.onUpdate) param.onUpdate(value);
            });
        } else if (param.type === 'button') {
            control = folder.add(param, 'value').name(key).onChange(() => {
                if (param.onUpdate) param.onUpdate(params);
                // Reset value to zero to simulate button behavior
                setTimeout(() => {
                    param.value = 0;
                    control.updateDisplay();
                }, 100);
            });
        } else if (param.type === 'label') {
            control = folder.add(param, 'value').name(key).listen();
        } else {
            control = folder.add(param, 'value').name(key).onChange(value => {
                sendOSCMessage(`${path}/${key}`, value);
                if (param.onUpdate) param.onUpdate(value);
            });
        }
    
        if (param.onUpdate) {
            control.__onUpdate = param.onUpdate;
        }
    
        return control;
    }
    

    createGUIControls(gui, params, '');

    initialParams = JSON.parse(JSON.stringify(params));
    saveSettingsAsPreset('factoryDefault');

    if (localStorage.getItem('appSettings')) {
        reloadSettings();
    } else {
        saveSettings();
    }

    if (params.lil_gui_oscws.value.gui.value.autoHide.value) {
        toggleGUIVisibility();
    }
}

function dumpParameters(params, path = '') {
    for (const key in params) {
        if (params.hasOwnProperty(key)) {
            const param = params[key];
            const currentPath = path ? `${path}/${key}` : key;
            if (param.type === 'folder') {
                dumpParameters(param.value, currentPath);
            } else {
                try {
                    sendOSCMessage(currentPath, param.value);
                    logDebug(`Dumping parameter: ${currentPath} - ${param.value}`);
                } catch (error) {
                    logError(`Error dumping parameter: ${currentPath} - ${param.value}`);
                    logError(error.message);
                    logError(error.stack);
                }
            }
        }
    }
}

function saveSettings() {
    const settings = gui.save();
    localStorage.setItem('appSettings', JSON.stringify(settings));
    logDebug('Settings saved:', settings);
}

function saveSettingsAsPreset(presetName) {
    const settings = gui.save();
    localStorage.setItem(presetName, JSON.stringify(settings));
    logDebug(`Preset ${presetName} saved:`, settings);
}

function reloadSettings() {
    const settings = localStorage.getItem('appSettings');
    if (settings) {
        const parsedSettings = JSON.parse(settings);
        gui.load(parsedSettings);
        logDebug('Settings reloaded:', parsedSettings);
    } else {
        logDebug('No settings found in local storage');
    }
}

function resetSettings() {
    const factoryDefaultSettings = localStorage.getItem('factoryDefault');
    if (factoryDefaultSettings) {
        const parsedSettings = JSON.parse(factoryDefaultSettings);
        restoreParameters(window.guiParams, window.initialParams);
        gui.load(parsedSettings);
        logDebug('Settings reset to factory default:', parsedSettings);
    } else {
        logDebug('No factory default settings found');
    }
}

function restoreParameters(target, source) {
    const stack = [{ target, source }];

    while (stack.length > 0) {
        const { target, source } = stack.pop();

        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (source[key].type === 'folder') {
                    stack.push({ target: target[key].value, source: source[key].value });
                } else {
                    target[key].value = source[key].value;
                    if (target[key].onUpdate) target[key].onUpdate(source[key].value);
                }
            }
        }
    }
}

function getSettingsParams() {
    return {
        lil_gui_oscws: {
            value: {
                gui: {
                    value: {
                        hide: { value: false, type: 'button', onUpdate: toggleGUIVisibility, save: false },
                        save: { value: false, type: 'button', onUpdate: saveSettings, save: false },
                        reload: { value: false, type: 'button', onUpdate: reloadSettings, save: false },
                        reset: { value: false, type: 'button', onUpdate: resetSettings, save: false },
                        autoHide: { value: false, type: 'boolean' } // New toggle for auto-hide
                    },
                    type: 'folder'
                },
                websocket: {
                    value: {
                        address: { value: '127.0.0.1', type: 'string' },
                        port: { value: 8080, min: 1024, max: 65535, step: 1, type: 'number' },
                        connect: { value: false, type: 'button', onUpdate: (params) => connectWebSocket(params), save: false },
                        disconnect: { value: false, type: 'button', onUpdate: (params) => disconnectWebSocket(params), save: false },
                        dump: { value: false, type: 'button', onUpdate: (params) => dumpParameters(params), save: false },
                        debugLog: { value: false, type: 'boolean', onUpdate: (params) => handleDebugLogToggle(params) },
                        autoReconnect: { value: false, type: 'boolean', onUpdate: (params) => handleAutoReconnectToggle(params) },
                        status: { value: 'Disconnected', type: 'label' },
                        autoConnect: { value: false, type: 'boolean' } // New toggle for auto-connect
                    },
                    type: 'folder'
                }
            },
            type: 'folder'
        }
    };
}
