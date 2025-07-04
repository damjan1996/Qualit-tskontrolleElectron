const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const path = require('path');
require('dotenv').config();

// Console-Encoding für Windows setzen
if (process.platform === 'win32') {
    try {
        process.stdout.setEncoding('utf8');
        process.stderr.setEncoding('utf8');
    } catch (error) {
        // Encoding setzen fehlgeschlagen - nicht kritisch
    }
}

// Nur sichere Module laden
const DatabaseClient = require('./db/db-client');

// SessionTypes Setup-Funktionen importieren
const { setupSessionTypes } = require('./db/constants/session-types');

// QC-spezifische Module
const QualityControlLogic = require('./logic/quality-control-logic');
const QualityControlQueries = require('./db/quality-control-queries');

// Simple RFID Listener laden (ohne native Dependencies)
let SimpleRFIDListener;
try {
    SimpleRFIDListener = require('./rfid/simple-rfid-listener');
    console.log('✅ Simple RFID Listener geladen');
} catch (error) {
    console.warn('⚠️ Simple RFID Listener nicht verfügbar:', error.message);
    console.log('💡 App läuft ohne RFID-Support');
}

class QualityControlMainApp {
    constructor() {
        this.mainWindow = null;
        this.rfidListener = null;
        this.dbClient = null;
        this.qualityControlLogic = null;
        this.qualityControlQueries = null;

        // Status-Tracking
        this.systemStatus = {
            database: false,
            rfid: false,
            sessionTypesSetup: false,
            qualityControlSetup: false,
            lastError: null
        };

        // NEUE DATENSTRUKTUR: Parallele Sessions für mehrere Benutzer
        this.activeSessions = new Map(); // userId -> sessionData
        this.activeSessionTimers = new Map(); // sessionId -> timerInterval

        // QC-spezifische Datenstrukturen
        this.activeQCSteps = new Map(); // sessionId -> Set von QC-Step-IDs
        this.qcStepCounters = new Map(); // sessionId -> { active: count, completed: count }

        // QR-Scan Rate Limiting (pro Session)
        this.qrScanRateLimit = new Map(); // sessionId -> scanTimes[]
        this.maxQRScansPerMinute = 30; // Höher für QC

        // QR-Code Dekodierung Statistiken (global)
        this.decodingStats = {
            totalScans: 0,
            successfulDecodes: 0,
            withAuftrag: 0,
            withPaket: 0,
            withKunde: 0
        };

        // RFID-Scan Tracking
        this.lastRFIDScanTime = 0;
        this.rfidScanCooldown = 2000; // 2 Sekunden zwischen RFID-Scans

        // SessionType für QC
        this.sessionTypePriority = ['Qualitätskontrolle', 'Wareneinlagerung'];

        this.initializeApp();
    }

    initializeApp() {
        // Hardware-Beschleunigung für bessere Kompatibilität anpassen
        app.commandLine.appendSwitch('--disable-gpu-process-crash-limit');
        app.commandLine.appendSwitch('--disable-gpu-sandbox');
        app.commandLine.appendSwitch('--disable-software-rasterizer');
        app.commandLine.appendSwitch('--disable-features', 'VizDisplayCompositor');

        // Für Windows: GPU-Probleme vermeiden
        if (process.platform === 'win32') {
            app.commandLine.appendSwitch('--disable-gpu');
            app.commandLine.appendSwitch('--disable-gpu-compositing');
        }

        // App bereit
        app.whenReady().then(() => {
            this.createMainWindow();
            this.initializeComponents();

            app.on('activate', () => {
                if (BrowserWindow.getAllWindows().length === 0) {
                    this.createMainWindow();
                }
            });
        });

        // App-Events
        app.on('window-all-closed', () => {
            this.cleanup();
            if (process.platform !== 'darwin') {
                app.quit();
            }
        });

        app.on('before-quit', () => {
            this.cleanup();
        });

        // IPC-Handler einrichten
        this.setupIPCHandlers();
    }

    createMainWindow() {
        const windowWidth = parseInt(process.env.UI_WINDOW_WIDTH) || 1600;
        const windowHeight = parseInt(process.env.UI_WINDOW_HEIGHT) || 1000;

        this.mainWindow = new BrowserWindow({
            width: windowWidth,
            height: windowHeight,
            minWidth: 1400,
            minHeight: 800,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js'),
                enableRemoteModule: false,
                webSecurity: true,
                // GPU-Problem-Workarounds
                disableBlinkFeatures: 'Accelerated2dCanvas,AcceleratedSmallCanvases',
                enableBlinkFeatures: '',
                hardwareAcceleration: false
            },
            show: false,
            title: 'RFID Qualitätskontrolle - Shirtful',
            autoHideMenuBar: true,
            frame: true,
            titleBarStyle: 'default',
            // Windows-spezifische Optionen
            ...(process.platform === 'win32' && {
                icon: path.join(__dirname, 'assets/icon.ico')
            })
        });

        // Renderer laden
        this.mainWindow.loadFile('renderer/index.html');

        // Fenster anzeigen wenn bereit
        this.mainWindow.once('ready-to-show', () => {
            this.mainWindow.show();

            // Development Tools
            if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
                this.mainWindow.webContents.openDevTools();
            }
        });

        // Fenster geschlossen
        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
        });

        // Prevent navigation away from the app
        this.mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
            const parsedUrl = new URL(navigationUrl);
            if (parsedUrl.origin !== 'file://') {
                event.preventDefault();
            }
        });

        // WebContents-Fehler abfangen
        this.mainWindow.webContents.on('render-process-gone', (event, details) => {
            console.error('Renderer-Prozess abgestürzt:', details);

            if (details.reason !== 'clean-exit') {
                dialog.showErrorBox(
                    'Anwendungsfehler',
                    'Die Anwendung ist unerwartet beendet worden. Sie wird neu gestartet.'
                );

                // Neustart nach kurzer Verzögerung
                setTimeout(() => {
                    this.createMainWindow();
                }, 1000);
            }
        });
    }

    async initializeComponents() {
        console.log('🔄 Initialisiere QC-Systemkomponenten...');

        // Datenbank zuerst
        await this.initializeDatabase();

        // QC-Module initialisieren
        await this.initializeQualityControl();

        // RFID-Listener (mit Fallback)
        await this.initializeRFID();

        // System-Status an Renderer senden
        this.sendSystemStatus();

        console.log('✅ QC-Systemkomponenten initialisiert');
    }

    async initializeDatabase() {
        try {
            console.log('📊 Initialisiere Datenbankverbindung...');

            this.dbClient = new DatabaseClient();
            await this.dbClient.connect();

            this.systemStatus.database = true;
            this.systemStatus.lastError = null;

            console.log('✅ Datenbank erfolgreich verbunden');

            // **KRITISCH: SessionTypes Setup ausführen**
            await this.setupSessionTypes();

            // QR-Code Dekodierung Statistiken laden
            await this.loadDecodingStats();

        } catch (error) {
            this.systemStatus.database = false;
            this.systemStatus.lastError = `Datenbank: ${error.message}`;

            console.error('❌ Datenbank-Initialisierung fehlgeschlagen:', error);

            // Benutzer informieren
            if (this.mainWindow) {
                dialog.showErrorBox(
                    'Datenbank-Verbindung fehlgeschlagen',
                    `Verbindung zur Datenbank konnte nicht hergestellt werden:\n\n${error.message}\n\n` +
                    'Bitte überprüfen Sie:\n' +
                    '• Netzwerkverbindung\n' +
                    '• .env Konfiguration\n' +
                    '• SQL Server Verfügbarkeit'
                );
            }
        }
    }

    /**
     * QC-spezifische Module initialisieren
     */
    async initializeQualityControl() {
        try {
            console.log('🔍 Initialisiere Qualitätskontrolle...');

            if (!this.dbClient || !this.systemStatus.database) {
                throw new Error('Datenbank nicht verfügbar für QC-Initialisierung');
            }

            // QC-Queries initialisieren
            this.qualityControlQueries = new QualityControlQueries(this.dbClient);

            // QC-Logic initialisieren
            this.qualityControlLogic = new QualityControlLogic(this.dbClient, this.qualityControlQueries);

            // QC-Datenbankschema erstellen/validieren
            await this.qualityControlQueries.setupQCSchema();

            this.systemStatus.qualityControlSetup = true;
            console.log('✅ Qualitätskontrolle erfolgreich initialisiert');

        } catch (error) {
            this.systemStatus.qualityControlSetup = false;
            this.systemStatus.lastError = `QC Setup: ${error.message}`;
            console.error('❌ QC-Initialisierung fehlgeschlagen:', error);

            // Nicht kritisch genug um das System zu stoppen
            console.warn('⚠️ System startet ohne vollständige QC-Funktionalität');
        }
    }

    /**
     * NEUE FUNKTION: SessionTypes Setup ausführen
     * Stellt sicher, dass alle SessionTypes in der Datenbank vorhanden sind
     */
    async setupSessionTypes() {
        try {
            console.log('🔧 Initialisiere SessionTypes...');

            // SessionTypes Setup mit roher Datenbankverbindung ausführen
            const success = await setupSessionTypes(this.dbClient);

            if (success) {
                this.systemStatus.sessionTypesSetup = true;
                console.log('✅ SessionTypes erfolgreich initialisiert');

                // Verfügbare SessionTypes anzeigen
                const sessionTypes = await this.dbClient.getSessionTypes();
                console.log(`📋 Verfügbare SessionTypes (${sessionTypes.length}):`);
                sessionTypes.forEach(type => {
                    console.log(`   - ${type.TypeName}: ${type.Description}`);
                });

                // SessionType-Priorität basierend auf verfügbaren Types aktualisieren
                this.updateSessionTypePriority(sessionTypes);

            } else {
                this.systemStatus.sessionTypesSetup = false;
                this.systemStatus.lastError = 'SessionTypes Setup fehlgeschlagen';
                console.error('❌ SessionTypes Setup fehlgeschlagen');

                // Weiter ausführen, aber mit Warnung
                console.warn('⚠️ System läuft möglicherweise eingeschränkt ohne SessionTypes');
            }

        } catch (error) {
            this.systemStatus.sessionTypesSetup = false;
            this.systemStatus.lastError = `SessionTypes Setup: ${error.message}`;
            console.error('❌ Fehler beim SessionTypes Setup:', error);

            // Nicht kritisch genug um das System zu stoppen
            console.warn('⚠️ System startet ohne SessionTypes Setup');
        }
    }

    /**
     * Aktualisiert die SessionType-Priorität basierend auf verfügbaren Types (QC-fokussiert)
     * @param {Array} availableSessionTypes - Verfügbare SessionTypes aus der DB
     */
    updateSessionTypePriority(availableSessionTypes) {
        const availableTypeNames = availableSessionTypes.map(type => type.TypeName);

        // QC-fokussierte Priorität
        this.sessionTypePriority = ['Qualitätskontrolle'];

        // Filtere nur verfügbare SessionTypes und behalte die Prioritätsreihenfolge bei
        this.sessionTypePriority = this.sessionTypePriority.filter(typeName =>
            availableTypeNames.includes(typeName)
        );

        // Füge weitere verfügbare Types hinzu, falls sie nicht in der Prioritätsliste sind
        availableTypeNames.forEach(typeName => {
            if (!this.sessionTypePriority.includes(typeName)) {
                this.sessionTypePriority.push(typeName);
            }
        });

        console.log(`🔧 QC-SessionType-Priorität aktualisiert: [${this.sessionTypePriority.join(', ')}]`);
    }

    async loadDecodingStats() {
        try {
            if (!this.dbClient || !this.systemStatus.database) return;

            const stats = await this.dbClient.getQRScanStats();
            if (stats) {
                this.decodingStats = {
                    totalScans: stats.TotalScans || 0,
                    successfulDecodes: stats.DecodedScans || 0,
                    withAuftrag: stats.ScansWithAuftrag || 0,
                    withPaket: stats.ScansWithPaket || 0,
                    withKunde: stats.ScansWithKunde || 0,
                    decodingSuccessRate: stats.DecodingSuccessRate || 0
                };

                console.log('📋 QC-QR-Code Dekodierung Statistiken geladen:', this.decodingStats);
            }
        } catch (error) {
            console.error('Fehler beim Laden der Dekodierung-Statistiken:', error);
        }
    }

    async initializeRFID() {
        try {
            console.log('🏷️ Initialisiere RFID-Listener...');

            if (!SimpleRFIDListener) {
                throw new Error('Simple RFID-Listener nicht verfügbar');
            }

            this.rfidListener = new SimpleRFIDListener((tagId) => {
                this.handleRFIDScan(tagId);
            });

            const started = await this.rfidListener.start();

            if (started) {
                this.systemStatus.rfid = true;
                console.log('✅ RFID-Listener erfolgreich gestartet');
            } else {
                throw new Error('RFID-Listener konnte nicht gestartet werden');
            }

        } catch (error) {
            this.systemStatus.rfid = false;
            this.systemStatus.lastError = `RFID: ${error.message}`;

            console.error('❌ RFID-Initialisierung fehlgeschlagen:', error);
            console.log('💡 RFID-Alternativen:');
            console.log('   1. Tags manuell in der UI simulieren');
            console.log('   2. Entwickler-Console für Tests verwenden');
            console.log('   3. Hardware später konfigurieren');

            // RFID ist nicht kritisch - App kann ohne laufen
        }
    }

    /**
     * NEUE HILFSFUNKTION: Session mit Fallback erstellen (QC-fokussiert)
     * Versucht verschiedene SessionTypes in Prioritätsreihenfolge
     * @param {number} userId - Benutzer ID
     * @param {Array} sessionTypePriority - Prioritätsliste der SessionTypes (optional)
     * @returns {Object} - { session, sessionTypeName, fallbackUsed }
     */
    async createSessionWithFallback(userId, sessionTypePriority = null) {
        const typesToTry = sessionTypePriority || this.sessionTypePriority;

        if (typesToTry.length === 0) {
            throw new Error('Keine SessionTypes verfügbar');
        }

        let lastError = null;

        for (const sessionType of typesToTry) {
            try {
                console.log(`🔄 Versuche QC-SessionType: ${sessionType}`);
                const session = await this.dbClient.createSession(userId, sessionType);

                if (session) {
                    const fallbackUsed = sessionType !== typesToTry[0];
                    console.log(`✅ QC-Session erfolgreich erstellt mit SessionType: ${sessionType}${fallbackUsed ? ' (Fallback)' : ''}`);

                    return {
                        session,
                        sessionTypeName: sessionType,
                        fallbackUsed
                    };
                }
            } catch (error) {
                console.warn(`⚠️ QC-SessionType '${sessionType}' nicht verfügbar: ${error.message}`);
                lastError = error;
                continue;
            }
        }

        // Wenn alle SessionTypes fehlschlagen
        throw new Error(`Alle QC-SessionTypes fehlgeschlagen. Letzter Fehler: ${lastError?.message || 'Unbekannt'}`);
    }

    setupIPCHandlers() {
        // ===== DATENBANK OPERATIONEN =====
        ipcMain.handle('db-query', async (event, query, params) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    throw new Error('Datenbank nicht verbunden');
                }
                return await this.dbClient.query(query, params);
            } catch (error) {
                console.error('DB Query Fehler:', error);
                throw error;
            }
        });

        ipcMain.handle('db-get-user-by-id', async (event, userId) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    return null;
                }
                return await this.dbClient.getUserById(userId);
            } catch (error) {
                console.error('Get User by ID Fehler:', error);
                return null;
            }
        });

        // ===== PARALLELE SESSION MANAGEMENT =====
        ipcMain.handle('session-get-all-active', async (event) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    return [];
                }

                // Aktive Sessions aus Datenbank laden
                const dbSessions = await this.dbClient.getActiveSessionsWithType();

                // Mit lokalen Session-Daten anreichern
                const enrichedSessions = dbSessions.map(session => {
                    const localSession = this.activeSessions.get(session.UserID);
                    return {
                        ...session,
                        StartTS: this.normalizeTimestamp(session.StartTS),
                        localStartTime: localSession ? localSession.startTime : session.StartTS
                    };
                });

                return enrichedSessions;
            } catch (error) {
                console.error('Fehler beim Abrufen aktiver Sessions:', error);
                return [];
            }
        });

        ipcMain.handle('session-create', async (event, userId) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    throw new Error('Datenbank nicht verbunden');
                }

                // QC-Session mit Fallback erstellen
                const { session, sessionTypeName, fallbackUsed } = await this.createSessionWithFallback(userId);

                if (session) {
                    // Lokale Session-Daten setzen/aktualisieren
                    this.activeSessions.set(userId, {
                        sessionId: session.ID,
                        userId: userId,
                        startTime: session.StartTS,
                        lastActivity: new Date(),
                        sessionType: sessionTypeName
                    });

                    // QC-spezifische Initialisierung
                    this.activeQCSteps.set(session.ID, new Set());
                    this.qcStepCounters.set(session.ID, { active: 0, completed: 0 });

                    // Session-Timer starten
                    this.startSessionTimer(session.ID, userId);

                    // Rate Limit für neue Session initialisieren
                    this.qrScanRateLimit.set(session.ID, []);

                    // Zeitstempel normalisieren für konsistente Übertragung
                    const normalizedSession = {
                        ...session,
                        StartTS: this.normalizeTimestamp(session.StartTS),
                        SessionTypeName: sessionTypeName,
                        FallbackUsed: fallbackUsed
                    };

                    console.log(`QC-Session erstellt für ${sessionTypeName}:`, normalizedSession);

                    if (fallbackUsed) {
                        console.warn(`⚠️ Fallback SessionType '${sessionTypeName}' verwendet`);
                    }

                    return normalizedSession;
                }

                return null;
            } catch (error) {
                console.error('QC-Session Create Fehler:', error);
                return null;
            }
        });

        ipcMain.handle('session-restart', async (event, sessionId, userId) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    return false;
                }

                // QC-Schritte für Session beenden vor Restart
                if (this.qualityControlLogic) {
                    await this.qualityControlLogic.abortActiveStepsForSession(sessionId);
                }

                // Session in Datenbank neu starten (StartTime aktualisieren)
                await this.dbClient.query(`
                    UPDATE Sessions 
                    SET StartTS = GETDATE()
                    WHERE ID = ? AND UserID = ? AND Active = 1
                `, [sessionId, userId]);

                // Lokale Session-Daten aktualisieren
                const localSession = this.activeSessions.get(userId);
                if (localSession) {
                    localSession.startTime = new Date();
                    localSession.lastActivity = new Date();
                }

                // QC-spezifische Reset
                this.activeQCSteps.set(sessionId, new Set());
                this.qcStepCounters.set(sessionId, { active: 0, completed: 0 });

                // Session-Timer neu starten
                this.stopSessionTimer(sessionId);
                this.startSessionTimer(sessionId, userId);

                console.log(`QC-Session ${sessionId} für Benutzer ${userId} neu gestartet`);
                return true;

            } catch (error) {
                console.error('QC-Session Restart Fehler:', error);
                return false;
            }
        });

        ipcMain.handle('session-end', async (event, sessionId, userId) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    return false;
                }

                // QC-Schritte für Session beenden
                if (this.qualityControlLogic) {
                    await this.qualityControlLogic.abortActiveStepsForSession(sessionId);
                }

                const success = await this.dbClient.endSession(sessionId);

                if (success) {
                    // Lokale Session-Daten entfernen
                    this.activeSessions.delete(userId);

                    // QC-spezifische Bereinigung
                    this.activeQCSteps.delete(sessionId);
                    this.qcStepCounters.delete(sessionId);

                    // Session-Timer stoppen
                    this.stopSessionTimer(sessionId);

                    // Rate Limit für Session zurücksetzen
                    this.qrScanRateLimit.delete(sessionId);

                    console.log(`QC-Session ${sessionId} für Benutzer ${userId} beendet`);
                }

                return success;
            } catch (error) {
                console.error('QC-Session End Fehler:', error);
                return false;
            }
        });

        // ===== QR-CODE OPERATIONEN =====
        ipcMain.handle('qr-scan-save', async (event, sessionId, payload) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    return {
                        success: false,
                        status: 'database_offline',
                        message: 'Datenbank nicht verbunden',
                        data: null,
                        timestamp: new Date().toISOString()
                    };
                }

                // Rate Limiting prüfen
                if (!this.checkQRScanRateLimit(sessionId)) {
                    return {
                        success: false,
                        status: 'rate_limit',
                        message: 'Zu viele QR-Scans pro Minute - bitte warten Sie',
                        data: null,
                        timestamp: new Date().toISOString()
                    };
                }

                // Payload bereinigen (BOM entfernen falls vorhanden)
                const cleanPayload = payload.replace(/^\ufeff/, '');

                // QR-Scan speichern
                const result = await this.dbClient.saveQRScan(sessionId, cleanPayload);

                // Rate Limit Counter aktualisieren bei erfolgreichen Scans
                if (result.success) {
                    this.updateQRScanRateLimit(sessionId);

                    // Dekodierung-Statistiken aktualisieren
                    await this.updateDecodingStats(result);

                    // Session-Aktivität aktualisieren
                    this.updateSessionActivity(sessionId);
                }

                console.log(`QC-QR-Scan Ergebnis für Session ${sessionId}:`, {
                    success: result.success,
                    status: result.status,
                    message: result.message,
                    hasDecodedData: !!(result.data?.DecodedData)
                });

                return result;

            } catch (error) {
                console.error('QC-QR Scan Save unerwarteter Fehler:', error);
                return {
                    success: false,
                    status: 'error',
                    message: `Unerwarteter Fehler: ${error.message}`,
                    data: null,
                    timestamp: new Date().toISOString()
                };
            }
        });

        // ===== QUALITÄTSKONTROLLE OPERATIONEN =====
        ipcMain.handle('quality-control-start-step', async (event, sessionId, qrCode, scanId) => {
            try {
                if (!this.qualityControlLogic) {
                    throw new Error('Qualitätskontrolle nicht verfügbar');
                }

                const qcStep = await this.qualityControlLogic.startQCStep(sessionId, qrCode, scanId);

                if (qcStep) {
                    // Lokale Tracking-Updates
                    const activeSteps = this.activeQCSteps.get(sessionId) || new Set();
                    activeSteps.add(qcStep.ID);
                    this.activeQCSteps.set(sessionId, activeSteps);

                    const counters = this.qcStepCounters.get(sessionId) || { active: 0, completed: 0 };
                    counters.active++;
                    this.qcStepCounters.set(sessionId, counters);

                    console.log(`✅ QC-Schritt ${qcStep.ID} gestartet für Session ${sessionId}`);
                }

                return qcStep;
            } catch (error) {
                console.error('QC-Start-Step Fehler:', error);
                return null;
            }
        });

        ipcMain.handle('quality-control-complete-step', async (event, sessionId, qrCode, scanId) => {
            try {
                if (!this.qualityControlLogic) {
                    throw new Error('Qualitätskontrolle nicht verfügbar');
                }

                const completedStep = await this.qualityControlLogic.completeQCStep(sessionId, qrCode, scanId);

                if (completedStep) {
                    // Lokale Tracking-Updates
                    const activeSteps = this.activeQCSteps.get(sessionId) || new Set();
                    activeSteps.delete(completedStep.ID);
                    this.activeQCSteps.set(sessionId, activeSteps);

                    const counters = this.qcStepCounters.get(sessionId) || { active: 0, completed: 0 };
                    counters.active--;
                    counters.completed++;
                    this.qcStepCounters.set(sessionId, counters);

                    console.log(`✅ QC-Schritt ${completedStep.ID} abgeschlossen für Session ${sessionId}`);
                }

                return completedStep;
            } catch (error) {
                console.error('QC-Complete-Step Fehler:', error);
                return null;
            }
        });

        ipcMain.handle('quality-control-get-active-steps', async (event, sessionId) => {
            try {
                if (!this.qualityControlQueries) {
                    return [];
                }

                return await this.qualityControlQueries.getActiveQCStepsForSession(sessionId);
            } catch (error) {
                console.error('QC-Get-Active-Steps Fehler:', error);
                return [];
            }
        });

        ipcMain.handle('quality-control-get-completed-today', async (event, sessionId) => {
            try {
                if (!this.qualityControlQueries) {
                    return [];
                }

                return await this.qualityControlQueries.getCompletedQCStepsToday(sessionId);
            } catch (error) {
                console.error('QC-Get-Completed-Today Fehler:', error);
                return [];
            }
        });

        ipcMain.handle('quality-control-get-step-details', async (event, stepId) => {
            try {
                if (!this.qualityControlQueries) {
                    return null;
                }

                return await this.qualityControlQueries.getQCStepDetails(stepId);
            } catch (error) {
                console.error('QC-Get-Step-Details Fehler:', error);
                return null;
            }
        });

        // ===== QR-CODE DEKODIERUNG OPERATIONEN =====
        ipcMain.handle('qr-get-decoded-scans', async (event, sessionId, limit = 50) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    return [];
                }

                const scans = await this.dbClient.getQRScansBySession(sessionId, limit);

                // Nur Scans mit dekodierten Daten zurückgeben
                return scans.filter(scan => scan.DecodedData && Object.keys(scan.DecodedData).length > 0);
            } catch (error) {
                console.error('Fehler beim Abrufen dekodierter QR-Scans:', error);
                return [];
            }
        });

        ipcMain.handle('qr-search-decoded', async (event, searchTerm, sessionId = null) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    return [];
                }

                return await this.dbClient.searchQRScans(searchTerm, sessionId, 20);
            } catch (error) {
                console.error('Fehler bei dekodierter QR-Code-Suche:', error);
                return [];
            }
        });

        ipcMain.handle('qr-get-decoding-stats', async (event, sessionId = null) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    return this.decodingStats;
                }

                const stats = await this.dbClient.getQRScanStats(sessionId);
                return {
                    ...this.decodingStats,
                    ...stats,
                    lastUpdated: new Date().toISOString()
                };
            } catch (error) {
                console.error('Fehler beim Abrufen der Dekodierung-Statistiken:', error);
                return this.decodingStats;
            }
        });

        // ===== SYSTEM STATUS =====
        ipcMain.handle('get-system-status', async (event) => {
            return {
                database: this.systemStatus.database,
                rfid: this.systemStatus.rfid,
                sessionTypesSetup: this.systemStatus.sessionTypesSetup,
                qualityControlSetup: this.systemStatus.qualityControlSetup,
                lastError: this.systemStatus.lastError,
                activeSessions: Array.from(this.activeSessions.values()),
                activeSessionCount: this.activeSessions.size,
                sessionTypePriority: this.sessionTypePriority,
                uptime: Math.floor(process.uptime()),
                timestamp: new Date().toISOString(),
                qrScanStats: this.getQRScanStats(),
                decodingStats: this.decodingStats,
                activeQCSteps: this.getTotalActiveQCSteps(),
                completedQCStepsToday: await this.getTotalCompletedQCStepsToday()
            };
        });

        ipcMain.handle('get-system-info', async (event) => {
            return {
                version: app.getVersion() || '1.0.0',
                electronVersion: process.versions.electron,
                nodeVersion: process.versions.node,
                platform: process.platform,
                arch: process.arch,
                env: process.env.NODE_ENV || 'production',
                type: 'quality-control',
                features: {
                    qrDecoding: true,
                    parallelSessions: true,
                    sessionRestart: true,
                    sessionTypeFallback: true,
                    sessionTypesSetup: this.systemStatus.sessionTypesSetup,
                    qualityControl: this.systemStatus.qualityControlSetup,
                    qcStepTracking: true,
                    qcEntranceExit: true,
                    decodingFormats: ['caret_separated', 'pattern_matching', 'structured_data'],
                    supportedFields: ['auftrags_nr', 'paket_nr', 'kunden_name']
                }
            };
        });

        // ===== RFID OPERATIONEN =====
        ipcMain.handle('rfid-get-status', async (event) => {
            return this.rfidListener ? this.rfidListener.getStatus() : {
                listening: false,
                type: 'not-available',
                message: 'RFID-Listener nicht verfügbar'
            };
        });

        ipcMain.handle('rfid-simulate-tag', async (event, tagId) => {
            try {
                if (!this.rfidListener) {
                    // Direkte Simulation wenn kein Listener verfügbar
                    console.log(`🧪 Direkte RFID-Simulation: ${tagId}`);
                    await this.handleRFIDScan(tagId);
                    return true;
                }
                return this.rfidListener.simulateTag(tagId);
            } catch (error) {
                console.error('RFID Simulate Fehler:', error);
                return false;
            }
        });

        // ===== APP STEUERUNG =====
        ipcMain.handle('app-minimize', () => {
            if (this.mainWindow) {
                this.mainWindow.minimize();
            }
        });

        ipcMain.handle('app-close', () => {
            app.quit();
        });

        ipcMain.handle('app-restart', () => {
            app.relaunch();
            app.exit();
        });
    }

    // ===== SESSION TIMER MANAGEMENT =====
    startSessionTimer(sessionId, userId) {
        // Bestehenden Timer stoppen falls vorhanden
        this.stopSessionTimer(sessionId);

        // Neuen Timer starten
        const timer = setInterval(() => {
            this.updateSessionTimer(sessionId, userId);
        }, 1000);

        this.activeSessionTimers.set(sessionId, timer);
        console.log(`Session-Timer gestartet für Session ${sessionId}`);
    }

    stopSessionTimer(sessionId) {
        const timer = this.activeSessionTimers.get(sessionId);
        if (timer) {
            clearInterval(timer);
            this.activeSessionTimers.delete(sessionId);
            console.log(`Session-Timer gestoppt für Session ${sessionId}`);
        }
    }

    updateSessionTimer(sessionId, userId) {
        const localSession = this.activeSessions.get(userId);
        if (localSession) {
            // Timer-Update an Frontend senden
            this.sendToRenderer('session-timer-update', {
                sessionId: sessionId,
                userId: userId,
                startTime: localSession.startTime,
                timestamp: new Date().toISOString()
            });
        }
    }

    updateSessionActivity(sessionId) {
        // Finde zugehörige Session und aktualisiere Aktivität
        for (const [userId, sessionData] of this.activeSessions.entries()) {
            if (sessionData.sessionId === sessionId) {
                sessionData.lastActivity = new Date();
                break;
            }
        }
    }

    // ===== QC-SPEZIFISCHE HILFSFUNKTIONEN =====
    getTotalActiveQCSteps() {
        let total = 0;
        for (const [sessionId, activeSteps] of this.activeQCSteps.entries()) {
            total += activeSteps.size;
        }
        return total;
    }

    async getTotalCompletedQCStepsToday() {
        try {
            if (!this.qualityControlQueries) {
                return 0;
            }

            const result = await this.qualityControlQueries.getCompletedQCStepsCountToday();
            return result || 0;
        } catch (error) {
            console.error('Fehler beim Abrufen der heute abgeschlossenen QC-Schritte:', error);
            return 0;
        }
    }

    // ===== VERBESSERTE RFID-VERARBEITUNG MIT QC-FALLBACK =====
    async handleRFIDScan(tagId) {
        const now = Date.now();

        // Cooldown für RFID-Scans prüfen
        if (now - this.lastRFIDScanTime < this.rfidScanCooldown) {
            console.log(`🔄 RFID-Scan zu schnell, ignoriert: ${tagId} (${now - this.lastRFIDScanTime}ms < ${this.rfidScanCooldown}ms)`);
            return;
        }
        this.lastRFIDScanTime = now;

        console.log(`🏷️ RFID-Tag gescannt: ${tagId}`);

        try {
            if (!this.systemStatus.database) {
                throw new Error('Datenbank nicht verbunden - RFID-Scan kann nicht verarbeitet werden');
            }

            // Benutzer anhand EPC finden
            const user = await this.dbClient.getUserByEPC(tagId);

            if (!user) {
                this.sendToRenderer('rfid-scan-error', {
                    tagId,
                    message: `Unbekannter RFID-Tag: ${tagId}`,
                    timestamp: new Date().toISOString()
                });
                return;
            }

            console.log(`👤 Benutzer gefunden: ${user.BenutzerName} (ID: ${user.ID})`);

            // Prüfen ob Benutzer bereits eine aktive Session hat
            const existingSession = this.activeSessions.get(user.ID);

            if (existingSession) {
                // ===== QC-SESSION-RESTART: Timer und QC-Status zurücksetzen =====
                console.log(`🔄 QC-Session-Restart für ${user.BenutzerName} (Session ${existingSession.sessionId})`);

                // QC-Schritte für Session beenden vor Restart
                if (this.qualityControlLogic) {
                    await this.qualityControlLogic.abortActiveStepsForSession(existingSession.sessionId);
                }

                // Session in Datenbank neu starten
                const restartSuccess = await this.dbClient.query(`
                    UPDATE Sessions
                    SET StartTS = GETDATE()
                    WHERE ID = ? AND UserID = ? AND Active = 1
                `, [existingSession.sessionId, user.ID]);

                if (restartSuccess) {
                    // Lokale Session-Daten aktualisieren
                    existingSession.startTime = new Date();
                    existingSession.lastActivity = new Date();

                    // QC-spezifische Reset
                    this.activeQCSteps.set(existingSession.sessionId, new Set());
                    this.qcStepCounters.set(existingSession.sessionId, { active: 0, completed: 0 });

                    // Session-Timer neu starten
                    this.stopSessionTimer(existingSession.sessionId);
                    this.startSessionTimer(existingSession.sessionId, user.ID);

                    // Session-Restart-Event senden
                    this.sendToRenderer('session-restarted', {
                        user,
                        sessionId: existingSession.sessionId,
                        sessionType: existingSession.sessionType || 'Qualitätskontrolle',
                        newStartTime: existingSession.startTime.toISOString(),
                        timestamp: new Date().toISOString(),
                        source: 'rfid_scan'
                    });

                    console.log(`✅ QC-Session erfolgreich neu gestartet für ${user.BenutzerName}`);
                } else {
                    this.sendToRenderer('rfid-scan-error', {
                        tagId,
                        message: 'Fehler beim QC-Session-Restart',
                        timestamp: new Date().toISOString()
                    });
                }

            } else {
                // ===== NEUE QC-SESSION ERSTELLEN MIT FALLBACK =====
                console.log(`🔑 Neue QC-Session für ${user.BenutzerName}...`);

                try {
                    const { session, sessionTypeName, fallbackUsed } = await this.createSessionWithFallback(user.ID);

                    if (session) {
                        // Lokale Session-Daten setzen
                        this.activeSessions.set(user.ID, {
                            sessionId: session.ID,
                            userId: user.ID,
                            startTime: session.StartTS,
                            lastActivity: new Date(),
                            sessionType: sessionTypeName
                        });

                        // QC-spezifische Initialisierung
                        this.activeQCSteps.set(session.ID, new Set());
                        this.qcStepCounters.set(session.ID, { active: 0, completed: 0 });

                        // Session-Timer starten
                        this.startSessionTimer(session.ID, user.ID);

                        // Rate Limit für neue Session initialisieren
                        this.qrScanRateLimit.set(session.ID, []);

                        // Session-Daten mit normalisiertem Zeitstempel senden
                        const normalizedSession = {
                            ...session,
                            StartTS: this.normalizeTimestamp(session.StartTS)
                        };

                        // Login-Event senden
                        this.sendToRenderer('user-login', {
                            user,
                            session: normalizedSession,
                            sessionType: sessionTypeName,
                            fallbackUsed: fallbackUsed,
                            timestamp: new Date().toISOString(),
                            source: 'rfid_scan',
                            isNewSession: true
                        });

                        console.log(`✅ Neue QC-Session erstellt für ${user.BenutzerName} (Session ${session.ID}, Type: ${sessionTypeName})`);

                        if (fallbackUsed) {
                            console.warn(`⚠️ Fallback SessionType '${sessionTypeName}' verwendet - primärer QC-SessionType nicht verfügbar`);

                            // Warnung an Renderer senden
                            this.sendToRenderer('session-fallback-warning', {
                                user,
                                sessionType: sessionTypeName,
                                primaryType: this.sessionTypePriority[0],
                                message: `Fallback SessionType '${sessionTypeName}' verwendet`,
                                timestamp: new Date().toISOString()
                            });
                        }
                    }
                } catch (sessionError) {
                    console.error(`❌ Konnte keine QC-Session erstellen für ${user.BenutzerName}:`, sessionError.message);

                    this.sendToRenderer('rfid-scan-error', {
                        tagId,
                        message: `Keine verfügbaren QC-SessionTypes: ${sessionError.message}`,
                        timestamp: new Date().toISOString(),
                        critical: true
                    });
                }
            }

        } catch (error) {
            console.error('RFID-Verarbeitungs-Fehler:', error);
            this.sendToRenderer('rfid-scan-error', {
                tagId,
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // ===== QR-CODE DEKODIERUNG STATISTIKEN =====
    async updateDecodingStats(scanResult) {
        try {
            if (!scanResult.success || !scanResult.data) return;

            this.decodingStats.totalScans++;

            const decodedData = scanResult.data.DecodedData;
            if (decodedData) {
                this.decodingStats.successfulDecodes++;

                if (decodedData.auftrags_nr && decodedData.auftrags_nr.trim()) {
                    this.decodingStats.withAuftrag++;
                }

                if (decodedData.paket_nr && decodedData.paket_nr.trim()) {
                    this.decodingStats.withPaket++;
                }

                if (decodedData.kunden_name && decodedData.kunden_name.trim()) {
                    this.decodingStats.withKunde++;
                }

                // Success Rate berechnen
                this.decodingStats.decodingSuccessRate = Math.round(
                    (this.decodingStats.successfulDecodes / this.decodingStats.totalScans) * 100
                );

                console.log(`📊 QC-Dekodierung-Statistiken aktualisiert:`, {
                    total: this.decodingStats.totalScans,
                    decoded: this.decodingStats.successfulDecodes,
                    rate: this.decodingStats.decodingSuccessRate + '%',
                    auftrag: this.decodingStats.withAuftrag,
                    paket: this.decodingStats.withPaket,
                    kunde: this.decodingStats.withKunde
                });

                // Statistiken an Renderer senden
                this.sendToRenderer('decoding-stats-updated', {
                    stats: this.decodingStats,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('Fehler beim Aktualisieren der QC-Dekodierung-Statistiken:', error);
        }
    }

    // ===== ZEITSTEMPEL NORMALISIERUNG =====
    normalizeTimestamp(timestamp) {
        try {
            let date;

            if (timestamp instanceof Date) {
                date = timestamp;
            } else if (typeof timestamp === 'string') {
                date = new Date(timestamp);
            } else {
                date = new Date(timestamp);
            }

            // Prüfe auf gültiges Datum
            if (isNaN(date.getTime())) {
                console.warn('Ungültiger Zeitstempel für Normalisierung:', timestamp);
                date = new Date(); // Fallback auf aktuelle Zeit
            }

            // ISO-String für konsistente Übertragung
            return date.toISOString();

        } catch (error) {
            console.error('Fehler bei Zeitstempel-Normalisierung:', error, timestamp);
            return new Date().toISOString(); // Fallback
        }
    }

    // ===== QR-SCAN RATE LIMITING =====
    checkQRScanRateLimit(sessionId) {
        const now = Date.now();
        const oneMinute = 60 * 1000;

        if (!this.qrScanRateLimit.has(sessionId)) {
            this.qrScanRateLimit.set(sessionId, []);
        }

        const scanTimes = this.qrScanRateLimit.get(sessionId);

        // Entferne Scans älter als 1 Minute
        const recentScans = scanTimes.filter(time => now - time < oneMinute);
        this.qrScanRateLimit.set(sessionId, recentScans);

        // Prüfe Limit
        return recentScans.length < this.maxQRScansPerMinute;
    }

    updateQRScanRateLimit(sessionId) {
        const now = Date.now();

        if (!this.qrScanRateLimit.has(sessionId)) {
            this.qrScanRateLimit.set(sessionId, []);
        }

        const scanTimes = this.qrScanRateLimit.get(sessionId);
        scanTimes.push(now);

        // Halte nur die letzten Scans
        if (scanTimes.length > this.maxQRScansPerMinute) {
            scanTimes.shift();
        }
    }

    getQRScanStats() {
        const stats = {};
        const now = Date.now();
        const oneMinute = 60 * 1000;

        for (const [sessionId, scanTimes] of this.qrScanRateLimit.entries()) {
            const recentScans = scanTimes.filter(time => now - time < oneMinute);
            stats[sessionId] = {
                scansPerMinute: recentScans.length,
                lastScan: scanTimes.length > 0 ? Math.max(...scanTimes) : null
            };
        }

        return stats;
    }

    // ===== COMMUNICATION =====
    sendToRenderer(channel, data) {
        if (this.mainWindow && this.mainWindow.webContents) {
            this.mainWindow.webContents.send(channel, data);
        }
    }

    sendSystemStatus() {
        this.sendToRenderer('system-ready', {
            database: this.systemStatus.database,
            rfid: this.systemStatus.rfid,
            sessionTypesSetup: this.systemStatus.sessionTypesSetup,
            qualityControlSetup: this.systemStatus.qualityControlSetup,
            sessionTypePriority: this.sessionTypePriority,
            lastError: this.systemStatus.lastError,
            timestamp: new Date().toISOString(),
            decodingStats: this.decodingStats,
            activeSessionCount: this.activeSessions.size,
            activeQCSteps: this.getTotalActiveQCSteps()
        });
    }

    // ===== CLEANUP =====
    async cleanup() {
        console.log('🧹 QC-Anwendung wird bereinigt...');

        try {
            // Alle Session-Timer stoppen
            for (const sessionId of this.activeSessionTimers.keys()) {
                this.stopSessionTimer(sessionId);
            }

            // Alle aktiven QC-Schritte beenden
            if (this.qualityControlLogic) {
                for (const [sessionId, activeSteps] of this.activeQCSteps.entries()) {
                    try {
                        await this.qualityControlLogic.abortActiveStepsForSession(sessionId);
                        console.log(`QC-Schritte für Session ${sessionId} beendet`);
                    } catch (error) {
                        console.error(`Fehler beim Beenden der QC-Schritte für Session ${sessionId}:`, error);
                    }
                }
            }

            // Alle aktiven Sessions beenden
            for (const [userId, sessionData] of this.activeSessions.entries()) {
                try {
                    await this.dbClient.endSession(sessionData.sessionId);
                    console.log(`Session ${sessionData.sessionId} für Benutzer ${userId} beendet`);
                } catch (error) {
                    console.error(`Fehler beim Beenden der Session ${sessionData.sessionId}:`, error);
                }
            }

            // Lokale Daten zurücksetzen
            this.activeSessions.clear();
            this.activeSessionTimers.clear();
            this.qrScanRateLimit.clear();
            this.activeQCSteps.clear();
            this.qcStepCounters.clear();

            // Dekodierung-Statistiken zurücksetzen
            this.decodingStats = {
                totalScans: 0,
                successfulDecodes: 0,
                withAuftrag: 0,
                withPaket: 0,
                withKunde: 0
            };

            // RFID-Listener stoppen
            if (this.rfidListener) {
                await this.rfidListener.stop();
                this.rfidListener = null;
            }

            // Alle globalen Shortcuts entfernen
            globalShortcut.unregisterAll();

            // Datenbankverbindung schließen
            if (this.dbClient) {
                await this.dbClient.close();
                this.dbClient = null;
            }

            console.log('✅ QC-Cleanup abgeschlossen');

        } catch (error) {
            console.error('❌ QC-Cleanup-Fehler:', error);
        }
    }

    // ===== ERROR HANDLING =====
    handleGlobalError(error) {
        console.error('Globaler QC-Anwendungsfehler:', error);

        this.sendToRenderer('system-error', {
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

// ===== ERROR HANDLING =====
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);

    // Versuche die App sauber zu beenden
    if (app) {
        app.quit();
    } else {
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// ===== APP INSTANCE =====
const qualityControlApp = new QualityControlMainApp();

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, focus our window instead
        if (qualityControlApp.mainWindow) {
            if (qualityControlApp.mainWindow.isMinimized()) {
                qualityControlApp.mainWindow.restore();
            }
            qualityControlApp.mainWindow.focus();
        }
    });
}