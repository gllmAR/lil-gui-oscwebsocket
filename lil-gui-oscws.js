import { GUI } from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19.2/+esm';

let oscPort = null;
let reconnectInterval = null;
let guiVisible = true;
let gui, controls = {};
let debugLogEnabled = false; // Added flag for debug logging
const showButton = document.createElement('div');
let WebSocketPort;

function setupShowButton() {
    showButton.id = 'showButton';
    showButton.innerText = 'Show';
    showButton.style.position = 'fixed';
    showButton.style.top = '10px';
    showButton.style.right = '10px';
    showButton.style.padding = '5px 10px';
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

            console.log(`Attempting to send OSC message: ${JSON.stringify(message)}`);
            
            try {
                oscPort.send(message);
                logDebug(`Sent OSC message: ${parameter} - ${oscArg.value}`);
            } catch (error) {
                console.error(`Error sending OSC message for ${parameter}: ${error.message}`);
                console.error(error.stack);
            }
        } else {
            console.warn(`Skipping undefined or null value for parameter: ${parameter}`);
        }
    } else {
        console.warn(`WebSocket not open. Cannot send message for parameter: ${parameter}`);
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
    if (params.settings.value.websocket.value.status.value === 'Connected') {
        disconnectWebSocket(params);
        connectWebSocket(params);
    }
}

function handleDebugLogToggle(params) {
    debugLogEnabled = params.settings.value.websocket.value.debugLog.value;
    logDebug('Debug logging', debugLogEnabled ? 'enabled' : 'disabled');
}

function handleAutoReconnectToggle(params) {
    if (params.settings.value.websocket.value.autoReconnect.value) {
        if (params.settings.value.websocket.value.status.value === 'Disconnected') {
            startAutoReconnect(params);
        }
    } else {
        stopAutoReconnect();
    }
}

function logDebug(...args) {
    if (debugLogEnabled) {
        console.log(...args);
    }
}

function startAutoReconnect(params) {
    if (!reconnectInterval) {
        reconnectInterval = setInterval(() => {
            if (params.settings.value.websocket.value.status.value === 'Disconnected') {
                logDebug('Attempting to reconnect WebSocket...');
                connectWebSocket(params);
            }
        }, 5000); // Added a delay to prevent continuous reconnection attempts
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
    oscPort = new WebSocketPort({
        url: `ws://${params.settings.value.websocket.value.address.value}:${params.settings.value.websocket.value.port.value}`
    });

    oscPort.open();

    oscPort.on("open", function () {
        params.settings.value.websocket.value.status.value = 'Connected';
        logDebug('WebSocket connected');
        stopAutoReconnect();
    });

    oscPort.on("close", function () {
        params.settings.value.websocket.value.status.value = 'Disconnected';
        logDebug('WebSocket disconnected');
        if (params.settings.value.websocket.value.autoReconnect.value) {
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
    params.settings.value.websocket.value.status.value = 'Disconnected';
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

    // Merge settings params with app params
    const settingsParams = getSettingsParams();
    const params = { ...settingsParams, ...appParams };

    // Function to create GUI controls dynamically
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

    // Function to create individual control based on parameter metadata
    function createControl(folder, param, key, path, params) {
        let control;
        if (param.type === 'number' || param.type === 'int') {
            control = folder.add(param, 'value', param.min, param.max).name(key);
            if (param.step !== undefined) {
                control.step(param.step);
            }
            control.onChange(value => {
                if (param.type === 'int') value = Math.round(value);
                sendOSCMessage(`${path}/${key}`, value);
                if (param.onUpdate) param.onUpdate(value);
            });
        } else if (param.type === 'color') {
            control = folder.addColor(param, 'value').name(key).onChange(value => {
                sendOSCMessage(`${path}/${key}`, value);
                if (param.onUpdate) param.onUpdate(value);
            });
        } else if (param.type === 'button') {
            control = folder.add(param, 'value').name(key).onChange(() => {
                param.value = false; // reset button state
                if (param.onUpdate) param.onUpdate(params);
            });
        } else if (param.type === 'boolean') {
            control = folder.add(param, 'value').name(key).onChange(value => {
                sendOSCMessage(`${path}/${key}`, value);
                if (param.onUpdate) param.onUpdate(params);
            });
        } else if (param.type === 'label') {
            control = folder.add(param, 'value').name(key).listen();
        } else if (param.type === 'string') {
            control = folder.add(param, 'value').name(key).onFinishChange(value => {
                sendOSCMessage(`${path}/${key}`, value);
                if (param.onUpdate) param.onUpdate(value);
            });
        }
        return control;
    }

    createGUIControls(gui, params, '');

    // Setup the show button
    setupShowButton();

    // Save params for later use in save/reload/reset functions
    window.guiParams = params;
}

export function initializeWebSocket() {
    const oscScript = document.createElement('script');
    oscScript.src = 'https://cdn.jsdelivr.net/npm/osc/dist/osc-browser.min.js';
    document.head.appendChild(oscScript);

    oscScript.onload = () => {
        WebSocketPort = osc.WebSocketPort;
        connectWebSocket(getSettingsParams()); // Added to ensure WebSocket is initialized after script is loaded
    };
}

// New dumpParameters function
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
                    console.error(`Error dumping parameter: ${currentPath} - ${param.value}`);
                    console.error(error.message);
                    console.error(error.stack);
                }
            }
        }
    }
}

// Function to save settings to local storage
function saveSettings() {
    const settings = JSON.stringify(window.guiParams);
    localStorage.setItem('appSettings', settings);
    if (debugLogEnabled) {
        console.log('Settings saved:', settings);
    }
}

// Function to reload settings from local storage
function reloadSettings() {
    const settings = localStorage.getItem('appSettings');
    if (settings) {
        const parsedSettings = JSON.parse(settings);
        applySettings(window.guiParams, parsedSettings);
        if (debugLogEnabled) {
            console.log('Settings reloaded:', parsedSettings);
        }
    } else {
        console.warn('No settings found in local storage');
    }
}

// Function to reset settings to default
function resetSettings() {
    const defaultParams = getDefaultParams();
    applySettings(window.guiParams, defaultParams);
    if (debugLogEnabled) {
        console.log('Settings reset to default:', defaultParams);
    }
}

// Function to apply settings
function applySettings(currentSettings, newSettings) {
    for (const key in newSettings) {
        if (newSettings.hasOwnProperty(key)) {
            if (typeof newSettings[key] === 'object' && newSettings[key] !== null && !Array.isArray(newSettings[key])) {
                applySettings(currentSettings[key].value, newSettings[key].value);
            } else {
                currentSettings[key].value = newSettings[key];
                if (currentSettings[key].onUpdate) {
                    currentSettings[key].onUpdate(newSettings[key]);
                }
                sendOSCMessage(key, newSettings[key]);
            }
        }
    }
}

// Function to get default parameters (mimics the initial appParams in the HTML file)
function getDefaultParams() {
    return {
        sides: { value: 3, min: 3, max: 12, step: 1, type: 'int', onUpdate: window.drawPolygon },
        color: { value: '#ff0000', type: 'color', onUpdate: window.drawPolygon },
        size: { value: 100, min: 10, max: 300, type: 'number', onUpdate: window.drawPolygon },
        transform: {
            value: {
                rotation: { value: 0, min: 0, max: 360, step: 1, type: 'number', onUpdate: window.drawPolygon },
                position_x: { value: 0, min: -300, max: 300, step: 1, type: 'number', onUpdate: window.drawPolygon },
                position_y: { value: 0, min: -300, max: 300, step: 1, type: 'number', onUpdate: window.drawPolygon }
            },
            type: 'folder'
        }
    };
}

function getSettingsParams() {
    return {
        settings: {
            value: {
                gui: {
                    value: {
                        hide: { value: false, type: 'button', onUpdate: toggleGUIVisibility }
                    },
                    type: 'folder'
                },
                websocket: {
                    value: {
                        address: { value: '127.0.0.1', type: 'string' },
                        port: { value: 8080, min: 1024, max: 65535, step: 1, type: 'int' },
                        connect: { value: false, type: 'button', onUpdate: (params) => connectWebSocket(params) },
                        disconnect: { value: false, type: 'button', onUpdate: (params) => disconnectWebSocket(params) },
                        dump: { value: false, type: 'button', onUpdate: (params) => dumpParameters(params) },
                        save: { value: false, type: 'button', onUpdate: (params) => saveSettings() }, // Added save button
                        reload: { value: false, type: 'button', onUpdate: (params) => reloadSettings() }, // Added reload button
                        reset: { value: false, type: 'button', onUpdate: (params) => resetSettings() }, // Added reset button
                        debugLog: { value: false, type: 'boolean', onUpdate: (params) => handleDebugLogToggle(params) },
                        autoReconnect: { value: false, type: 'boolean', onUpdate: (params) => handleAutoReconnectToggle(params) },
                        status: { value: 'Disconnected', type: 'label' }
                    },
                    type: 'folder'
                }
            },
            type: 'folder'
        }
    };
}
