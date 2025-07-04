// tests/setup/jest.setup.js
/**
 * Jest Setup für RFID QR Wareneinlagerung Tests
 * Globale Konfiguration und Mocks für alle Tests
 */

const path = require('path');
const fs = require('fs');

// Jest Extensions für bessere Assertions
require('jest-extended');

// Console-Ausgaben für Tests optimieren
if (process.env.NODE_ENV === 'test') {
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
}

// Globale Test-Timeouts
jest.setTimeout(30000);

// ===== UMGEBUNGSVARIABLEN FÜR TESTS =====
process.env.NODE_ENV = 'test';
process.env.MSSQL_SERVER = 'localhost';
process.env.MSSQL_DATABASE = 'RdScanner_Test';
process.env.MSSQL_USER = 'test_user';
process.env.MSSQL_PASSWORD = 'test_password';
process.env.MSSQL_PORT = '1433';
process.env.MSSQL_ENCRYPT = 'false';
process.env.MSSQL_TRUST_CERT = 'true';

// UI Konfiguration für Tests
process.env.UI_WINDOW_WIDTH = '1200';
process.env.UI_WINDOW_HEIGHT = '800';
process.env.UI_THEME = 'light';

// RFID Konfiguration für Tests
process.env.RFID_MIN_SCAN_INTERVAL = '100';
process.env.RFID_INPUT_TIMEOUT = '200';
process.env.RFID_MAX_BUFFER_LENGTH = '15';

// QR Scanner Konfiguration für Tests
process.env.QR_GLOBAL_COOLDOWN = '1000';
process.env.QR_SESSION_COOLDOWN = '500';

// ===== GLOBALE MOCKS =====

// Electron Mocks
global.mockElectron = {
    app: {
        getVersion: jest.fn(() => '1.0.0'),
        getPath: jest.fn(() => '/test/path'),
        whenReady: jest.fn(() => Promise.resolve()),
        on: jest.fn(),
        quit: jest.fn(),
        relaunch: jest.fn(),
        exit: jest.fn(),
        requestSingleInstanceLock: jest.fn(() => true),
        commandLine: {
            appendSwitch: jest.fn()
        }
    },
    BrowserWindow: jest.fn().mockImplementation(() => ({
        loadFile: jest.fn(() => Promise.resolve()),
        show: jest.fn(),
        close: jest.fn(),
        minimize: jest.fn(),
        maximize: jest.fn(),
        on: jest.fn(),
        once: jest.fn(),
        webContents: {
            send: jest.fn(),
            on: jest.fn(),
            openDevTools: jest.fn()
        },
        isMinimized: jest.fn(() => false),
        focus: jest.fn()
    })),
    ipcMain: {
        handle: jest.fn(),
        on: jest.fn(),
        removeAllListeners: jest.fn()
    },
    ipcRenderer: {
        invoke: jest.fn(),
        on: jest.fn(),
        removeAllListeners: jest.fn()
    },
    globalShortcut: {
        register: jest.fn(() => true),
        unregister: jest.fn(),
        unregisterAll: jest.fn(),
        isRegistered: jest.fn(() => false)
    },
    dialog: {
        showErrorBox: jest.fn(),
        showMessageBox: jest.fn(() => Promise.resolve({ response: 0 }))
    },
    contextBridge: {
        exposeInMainWorld: jest.fn()
    }
};

// Node-HID Mock
global.mockNodeHid = {
    HID: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        close: jest.fn(),
        write: jest.fn(),
        getFeatureReport: jest.fn(),
        sendFeatureReport: jest.fn()
    })),
    devices: jest.fn(() => [
        {
            vendorId: 0x08ff,
            productId: 0x0009,
            path: 'test-hid-device',
            serialNumber: 'TEST123',
            manufacturer: 'Test RFID',
            product: 'Test RFID Reader',
            release: 1,
            interface: 0,
            usagePage: 1,
            usage: 6
        }
    ])
};

// SQL Server Mock
global.mockMSSql = {
    ConnectionPool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(() => Promise.resolve()),
        close: jest.fn(() => Promise.resolve()),
        request: jest.fn(() => ({
            input: jest.fn().mockReturnThis(),
            query: jest.fn(() => Promise.resolve({
                recordset: [],
                rowsAffected: [0]
            }))
        }))
    })),
    Request: jest.fn().mockImplementation(() => ({
        input: jest.fn().mockReturnThis(),
        query: jest.fn(() => Promise.resolve({
            recordset: [],
            rowsAffected: [0]
        }))
    })),
    Transaction: jest.fn().mockImplementation(() => ({
        begin: jest.fn(() => Promise.resolve()),
        commit: jest.fn(() => Promise.resolve()),
        rollback: jest.fn(() => Promise.resolve())
    })),
    connect: jest.fn(() => Promise.resolve({
        request: jest.fn(() => ({
            input: jest.fn().mockReturnThis(),
            query: jest.fn(() => Promise.resolve({
                recordset: [{ test: 1, serverTime: new Date() }],
                rowsAffected: [1]
            }))
        })),
        close: jest.fn(() => Promise.resolve())
    })),
    NVarChar: 'nvarchar',
    Int: 'int',
    BigInt: 'bigint',
    DateTime2: 'datetime2',
    Bit: 'bit',
    Float: 'float'
};

// Navigator Mock für Frontend-Tests
global.mockNavigator = {
    mediaDevices: {
        getUserMedia: jest.fn(() => Promise.resolve({
            getTracks: jest.fn(() => [
                { stop: jest.fn(), kind: 'video' }
            ])
        })),
        enumerateDevices: jest.fn(() => Promise.resolve([
            {
                deviceId: 'camera1',
                kind: 'videoinput',
                label: 'Test Camera',
                groupId: 'group1'
            }
        ])),
        getSupportedConstraints: jest.fn(() => ({
            width: true,
            height: true,
            frameRate: true
        }))
    },
    permissions: {
        query: jest.fn(() => Promise.resolve({ state: 'granted' }))
    },
    userAgent: 'Jest Test Environment',
    language: 'de-DE'
};

// Canvas Mock für QR-Code-Tests
global.mockCanvas = {
    getContext: jest.fn(() => ({
        drawImage: jest.fn(),
        getImageData: jest.fn(() => ({
            data: new Uint8ClampedArray(640 * 480 * 4),
            width: 640,
            height: 480
        })),
        putImageData: jest.fn(),
        clearRect: jest.fn(),
        fillRect: jest.fn(),
        strokeRect: jest.fn()
    })),
    width: 640,
    height: 480,
    toDataURL: jest.fn(() => 'data:image/png;base64,test')
};

// Audio Context Mock
global.AudioContext = jest.fn().mockImplementation(() => ({
    createOscillator: jest.fn(() => ({
        connect: jest.fn(),
        frequency: {
            setValueAtTime: jest.fn(),
            exponentialRampToValueAtTime: jest.fn()
        },
        start: jest.fn(),
        stop: jest.fn()
    })),
    createGain: jest.fn(() => ({
        connect: jest.fn(),
        gain: {
            setValueAtTime: jest.fn(),
            exponentialRampToValueAtTime: jest.fn()
        }
    })),
    destination: {},
    currentTime: 0
}));

// ===== HELPER FUNKTIONEN FÜR TESTS =====

// Test-Datenbank-Verbindung
global.createTestDbClient = () => {
    const DatabaseClient = require('../mocks/db-client.mock');
    return new DatabaseClient();
};

// Test-Benutzer generieren
global.createTestUser = (overrides = {}) => ({
    ID: 1,
    Vorname: 'Test',
    Nachname: 'Benutzer',
    BenutzerName: 'Test Benutzer',
    Email: 'test@example.com',
    EPC: 1392525588, // 53004114 in hex
    xStatus: 0,
    ...overrides
});

// Test-Session generieren
global.createTestSession = (overrides = {}) => ({
    ID: 1,
    UserID: 1,
    StartTS: new Date().toISOString(),
    EndTS: null,
    Active: 1,
    ...overrides
});

// Test-QR-Scan generieren
global.createTestQRScan = (overrides = {}) => ({
    ID: 1,
    SessionID: 1,
    RawPayload: 'TEST_QR_CODE_123',
    CapturedTS: new Date().toISOString(),
    Valid: 1,
    ...overrides
});

// RFID-Tag generieren
global.createTestRFIDTag = (hex = '53004114') => ({
    hex: hex,
    decimal: parseInt(hex, 16),
    bytes: Buffer.from(hex, 'hex')
});

// Mock QR-Code Daten
global.createTestQRCode = (type = 'json') => {
    switch (type) {
        case 'json':
            return JSON.stringify({
                type: 'package',
                id: 'PKG001',
                timestamp: new Date().toISOString()
            });
        case 'barcode':
            return '1234567890123';
        case 'url':
            return 'https://example.com/package/123';
        case 'keyvalue':
            return 'kunde:TestKunde^auftrag:A001^paket:P123';
        default:
            return 'TEST_QR_CODE_PLAIN_TEXT';
    }
};

// Zeitstempel-Utilities
global.testTimeUtils = {
    now: () => new Date().toISOString(),
    addMinutes: (date, minutes) => {
        const result = new Date(date);
        result.setMinutes(result.getMinutes() + minutes);
        return result.toISOString();
    },
    subtractMinutes: (date, minutes) => {
        const result = new Date(date);
        result.setMinutes(result.getMinutes() - minutes);
        return result.toISOString();
    }
};

// Event-Emitter für Tests
global.createTestEventEmitter = () => {
    const EventEmitter = require('events');
    return new EventEmitter();
};

// Async-Test-Helpers
global.waitFor = (ms) => new Promise(resolve => setTimeout(resolve, ms));

global.waitForCondition = async (condition, timeout = 5000, interval = 100) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (await condition()) {
            return true;
        }
        await waitFor(interval);
    }
    throw new Error(`Condition not met within ${timeout}ms`);
};

// File System Mock Setup
global.setupMockFS = () => {
    const mockfs = require('mock-fs');

    mockfs({
        '.env': `
MSSQL_SERVER=localhost
MSSQL_DATABASE=RdScanner_Test
MSSQL_USER=test_user
MSSQL_PASSWORD=test_password
MSSQL_PORT=1433
MSSQL_ENCRYPT=false
MSSQL_TRUST_CERT=true
`,
        'package.json': JSON.stringify({
            name: 'Wareneinlagerung-rfid-qr',
            version: '1.0.0'
        }),
        'renderer/index.html': '<html><body><div id="app"></div></body></html>',
        'renderer/app.js': 'console.log("test app");',
        'renderer/styles.css': 'body { margin: 0; }',
        'node_modules': mockfs.directory()
    });
};

global.teardownMockFS = () => {
    const mockfs = require('mock-fs');
    mockfs.restore();
};

// ===== BEFORE/AFTER HOOKS =====

beforeEach(() => {
    // Reset alle Mocks vor jedem Test
    jest.clearAllMocks();

    // Console-Mocks zurücksetzen
    if (console.log.mockClear) console.log.mockClear();
    if (console.warn.mockClear) console.warn.mockClear();
    if (console.error.mockClear) console.error.mockClear();
});

afterEach(async () => {
    // Cleanup nach jedem Test
    jest.restoreAllMocks();
});

beforeAll(() => {
    // Globale Setup-Operationen
    console.log('🧪 Jest Test-Suite wird initialisiert...');
});

afterAll(() => {
    // Globale Cleanup-Operationen
    console.log('🏁 Jest Test-Suite abgeschlossen');
});

// ===== ERROR HANDLING =====

// Unhandled Promise Rejections abfangen
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection in Test:', reason);
    // Nicht den Prozess beenden, da es ein Test ist
});

// Uncaught Exceptions abfangen
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception in Test:', error);
    // Nicht den Prozess beenden, da es ein Test ist
});

console.log('✅ Jest Setup abgeschlossen');