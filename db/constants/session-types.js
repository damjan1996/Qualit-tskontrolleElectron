/**
 * SessionType Constants and Helper Functions
 * Defines standard session types and provides helper functions for session management
 */

// ===== SESSIONTYPE CONSTANTS =====

/**
 * Standard SessionTypes für die Anwendung
 */
const SESSION_TYPES = {
    WARENEINLAGERUNG: 'Wareneinlagerung',  // Hauptfunktion der Anwendung
    Wareneinlagerung: 'Wareneinlagerung',          // Alternative/Legacy
    QUALITAETSKONTROLLE: 'Qualitätskontrolle',
    KOMMISSIONIERUNG: 'Kommissionierung',
    INVENTUR: 'Inventur',
    WARTUNG: 'Wartung'
};

/**
 * SessionType Konfigurationen mit Metadaten
 */
const SESSION_TYPE_CONFIG = {
    [SESSION_TYPES.WARENEINLAGERUNG]: {
        id: SESSION_TYPES.WARENEINLAGERUNG,
        name: 'Wareneinlagerung',
        description: 'Eingehende Waren scannen und einlagern - Hauptfunktion',
        icon: '📦',
        color: 'blue',
        defaultDuration: 480, // 8 Stunden in Minuten
        allowedQRTypes: ['decoded_qr', 'caret_separated', 'star_separated'],
        priority: 1
    },
    [SESSION_TYPES.Wareneinlagerung]: {
        id: SESSION_TYPES.Wareneinlagerung,
        name: 'Wareneinlagerung',
        description: 'Eingehende Waren scannen und verarbeiten - Legacy',
        icon: '📥',
        color: 'lightblue',
        defaultDuration: 480, // 8 Stunden in Minuten
        allowedQRTypes: ['decoded_qr', 'caret_separated', 'star_separated'],
        priority: 2
    },
    [SESSION_TYPES.QUALITAETSKONTROLLE]: {
        id: SESSION_TYPES.QUALITAETSKONTROLLE,
        name: 'Qualitätskontrolle',
        description: 'Qualitätsprüfung von Waren und Produkten',
        icon: '🔍',
        color: 'orange',
        defaultDuration: 240, // 4 Stunden in Minuten
        allowedQRTypes: ['decoded_qr', 'barcode', 'alphanumeric'],
        priority: 3
    },
    [SESSION_TYPES.KOMMISSIONIERUNG]: {
        id: SESSION_TYPES.KOMMISSIONIERUNG,
        name: 'Kommissionierung',
        description: 'Zusammenstellung von Bestellungen',
        icon: '📋',
        color: 'green',
        defaultDuration: 480, // 8 Stunden in Minuten
        allowedQRTypes: ['decoded_qr', 'caret_separated'],
        priority: 4
    },
    [SESSION_TYPES.INVENTUR]: {
        id: SESSION_TYPES.INVENTUR,
        name: 'Inventur',
        description: 'Bestandserfassung und Inventur',
        icon: '📊',
        color: 'purple',
        defaultDuration: 360, // 6 Stunden in Minuten
        allowedQRTypes: ['decoded_qr', 'barcode', 'alphanumeric'],
        priority: 5
    },
    [SESSION_TYPES.WARTUNG]: {
        id: SESSION_TYPES.WARTUNG,
        name: 'Wartung',
        description: 'Wartung und Instandhaltung',
        icon: '🔧',
        color: 'red',
        defaultDuration: 120, // 2 Stunden in Minuten
        allowedQRTypes: ['decoded_qr', 'text', 'url'],
        priority: 6
    }
};

// ===== HELPER FUNCTIONS =====

/**
 * Helper-Funktion zum Erstellen einer Wareneinlagerung-Session
 * @param {Object} dbClient - Datenbankverbindung (muss sessions module haben)
 * @param {number} userId - Benutzer-ID
 * @returns {Object|null} - Neue Session oder null
 */
async function createWareneinlagerungSession(dbClient, userId) {
    if (!dbClient.sessions) {
        throw new Error('DatabaseClient muss sessions module haben');
    }
    return await dbClient.sessions.createSession(userId, SESSION_TYPES.WARENEINLAGERUNG);
}

/**
 * Helper-Funktion zum Abrufen der SessionType-ID für Wareneinlagerung
 * @param {Object} dbClient - Datenbankverbindung (muss sessions module haben)
 * @returns {number|null} - SessionType ID oder null
 */
async function getWareneinlagerungSessionTypeId(dbClient) {
    try {
        if (!dbClient.sessions) {
            throw new Error('DatabaseClient muss sessions module haben');
        }

        const types = await dbClient.sessions.getSessionTypes();
        const wareneinlagerung = types.find(type => type.TypeName === SESSION_TYPES.WARENEINLAGERUNG);
        return wareneinlagerung ? wareneinlagerung.ID : null;
    } catch (error) {
        console.error('Fehler beim Abrufen der Wareneinlagerung SessionType ID:', error);
        return null;
    }
}

/**
 * Legacy: Helper-Funktion zum Erstellen einer Wareneinlagerung-Session
 * @param {Object} dbClient - Datenbankverbindung (muss sessions module haben)
 * @param {number} userId - Benutzer-ID
 * @returns {Object|null} - Neue Session oder null
 */
async function createWareneinlagerungSession(dbClient, userId) {
    if (!dbClient.sessions) {
        throw new Error('DatabaseClient muss sessions module haben');
    }
    return await dbClient.sessions.createSession(userId, SESSION_TYPES.Wareneinlagerung);
}

/**
 * Legacy: Helper-Funktion zum Abrufen der SessionType-ID für Wareneinlagerung
 * @param {Object} dbClient - Datenbankverbindung (muss sessions module haben)
 * @returns {number|null} - SessionType ID oder null
 */
async function getWareneinlagerungSessionTypeId(dbClient) {
    try {
        if (!dbClient.sessions) {
            throw new Error('DatabaseClient muss sessions module haben');
        }

        const types = await dbClient.sessions.getSessionTypes();
        const Wareneinlagerung = types.find(type => type.TypeName === SESSION_TYPES.Wareneinlagerung);
        return Wareneinlagerung ? Wareneinlagerung.ID : null;
    } catch (error) {
        console.error('Fehler beim Abrufen der Wareneinlagerung SessionType ID:', error);
        return null;
    }
}

/**
 * Abrufen der Konfiguration für einen SessionType
 * @param {string} sessionTypeName - Name des SessionTypes
 * @returns {Object|null} - SessionType Konfiguration oder null
 */
function getSessionTypeConfig(sessionTypeName) {
    return SESSION_TYPE_CONFIG[sessionTypeName] || null;
}

/**
 * Alle verfügbaren SessionType Konfigurationen abrufen
 * @returns {Array} - Array von SessionType Konfigurationen
 */
function getAllSessionTypeConfigs() {
    return Object.values(SESSION_TYPE_CONFIG).sort((a, b) => a.priority - b.priority);
}

/**
 * Prüfen ob ein QR-Code-Typ für einen SessionType erlaubt ist
 * @param {string} sessionTypeName - Name des SessionTypes
 * @param {string} qrType - QR-Code-Typ
 * @returns {boolean} - True wenn erlaubt, false wenn nicht
 */
function isQRTypeAllowedForSession(sessionTypeName, qrType) {
    const config = getSessionTypeConfig(sessionTypeName);
    return config ? config.allowedQRTypes.includes(qrType) : true;
}

/**
 * Standardmäßige Session-Dauer für einen SessionType abrufen
 * @param {string} sessionTypeName - Name des SessionTypes
 * @returns {number} - Dauer in Minuten
 */
function getDefaultSessionDuration(sessionTypeName) {
    const config = getSessionTypeConfig(sessionTypeName);
    return config ? config.defaultDuration : 480; // 8 Stunden als Fallback
}

/**
 * SessionType-spezifische Validierung für QR-Scans
 * @param {string} sessionTypeName - Name des SessionTypes
 * @param {Object} qrData - QR-Code Daten
 * @returns {Object} - Validierungsergebnis { isValid: boolean, message?: string }
 */
function validateQRForSessionType(sessionTypeName, qrData) {
    const config = getSessionTypeConfig(sessionTypeName);

    if (!config) {
        return { isValid: true }; // Keine Konfiguration = alle QR-Codes erlaubt
    }

    // QR-Typ validieren falls vorhanden
    if (qrData.type && !config.allowedQRTypes.includes(qrData.type)) {
        return {
            isValid: false,
            message: `QR-Code-Typ '${qrData.type}' nicht erlaubt für ${sessionTypeName}`
        };
    }

    return { isValid: true };
}

/**
 * SessionType-Icon für UI abrufen
 * @param {string} sessionTypeName - Name des SessionTypes
 * @returns {string} - Icon
 */
function getSessionTypeIcon(sessionTypeName) {
    const config = getSessionTypeConfig(sessionTypeName);
    return config ? config.icon : '📄';
}

/**
 * SessionType-Farbe für UI abrufen
 * @param {string} sessionTypeName - Name des SessionTypes
 * @returns {string} - Farbe
 */
function getSessionTypeColor(sessionTypeName) {
    const config = getSessionTypeConfig(sessionTypeName);
    return config ? config.color : 'gray';
}

/**
 * Erstelle Session-spezifische Statistik-Filter
 * @param {string} sessionTypeName - Name des SessionTypes
 * @returns {Object} - Filter-Konfiguration für Statistiken
 */
function getSessionTypeStatsFilter(sessionTypeName) {
    const config = getSessionTypeConfig(sessionTypeName);

    if (!config) {
        return { allowedQRTypes: [] };
    }

    return {
        sessionType: sessionTypeName,
        allowedQRTypes: config.allowedQRTypes,
        expectedDuration: config.defaultDuration,
        priority: config.priority
    };
}

// ===== MIGRATION HELPERS =====

/**
 * Hilfsfunktion zum Erstellen der SessionTypes Tabelle (für Setup)
 * @param {Object} dbConnection - Datenbankverbindung
 * @returns {boolean} - Success
 */
async function createSessionTypesTable(dbConnection) {
    try {
        await dbConnection.query(`
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'SessionTypes')
            BEGIN
                CREATE TABLE dbo.SessionTypes (
                    ID INT IDENTITY(1,1) PRIMARY KEY,
                    TypeName NVARCHAR(100) NOT NULL UNIQUE,
                    Description NVARCHAR(500),
                    IsActive BIT NOT NULL DEFAULT 1,
                    CreatedTS DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
                    UpdatedTS DATETIME2 NOT NULL DEFAULT SYSDATETIME()
                )
            END
        `);

        console.log('[INFO] SessionTypes Tabelle erstellt oder bereits vorhanden');
        return true;
    } catch (error) {
        console.error('[ERROR] Fehler beim Erstellen der SessionTypes Tabelle:', error);
        return false;
    }
}

/**
 * Hilfsfunktion zum Einfügen der Standard-SessionTypes
 * @param {Object} dbConnection - Datenbankverbindung
 * @returns {boolean} - Success
 */
async function insertDefaultSessionTypes(dbConnection) {
    try {
        // WICHTIG: Definiere die SessionTypes explizit in der richtigen Reihenfolge
        const sessionTypesToInsert = [
            {
                name: 'Wareneinlagerung',
                description: 'Eingehende Waren scannen und einlagern - Hauptfunktion'
            },
            {
                name: 'Wareneinlagerung',
                description: 'Eingehende Waren scannen und verarbeiten - Legacy'
            },
            {
                name: 'Qualitätskontrolle',
                description: 'Qualitätsprüfung von Waren und Produkten'
            },
            {
                name: 'Kommissionierung',
                description: 'Zusammenstellung von Bestellungen'
            },
            {
                name: 'Inventur',
                description: 'Bestandserfassung und Inventur'
            },
            {
                name: 'Wartung',
                description: 'Wartung und Instandhaltung'
            }
        ];

        for (const sessionType of sessionTypesToInsert) {
            // Prüfe ob SessionType bereits existiert
            const existingResult = await dbConnection.query(`
                SELECT COUNT(*) as count FROM dbo.SessionTypes WHERE TypeName = ?
            `, [sessionType.name]);

            if (existingResult.recordset[0].count === 0) {
                // SessionType einfügen
                await dbConnection.query(`
                    INSERT INTO dbo.SessionTypes (TypeName, Description, IsActive)
                    VALUES (?, ?, 1)
                `, [sessionType.name, sessionType.description]);

                console.log(`[INFO] SessionType '${sessionType.name}' eingefügt`);
            } else {
                console.log(`[INFO] SessionType '${sessionType.name}' bereits vorhanden`);
            }
        }

        return true;
    } catch (error) {
        console.error('[ERROR] Fehler beim Einfügen der Standard-SessionTypes:', error);
        return false;
    }
}

/**
 * Vollständige SessionTypes Setup-Funktion
 * @param {Object} dbConnection - Datenbankverbindung
 * @returns {boolean} - Success
 */
async function setupSessionTypes(dbConnection) {
    try {
        console.log('[INFO] 🔧 Setup der SessionTypes wird gestartet...');

        const tableCreated = await createSessionTypesTable(dbConnection);
        if (!tableCreated) {
            return false;
        }

        const typesInserted = await insertDefaultSessionTypes(dbConnection);
        if (!typesInserted) {
            return false;
        }

        // Verify that Wareneinlagerung was inserted
        try {
            const verifyResult = await dbConnection.query(`
                SELECT COUNT(*) as count FROM dbo.SessionTypes 
                WHERE TypeName = 'Wareneinlagerung' AND IsActive = 1
            `);

            if (verifyResult.recordset[0].count === 0) {
                console.log('[WARN] ⚠️ Wareneinlagerung SessionType nicht gefunden - füge direkt hinzu...');

                // Direkt einfügen als Fallback
                await dbConnection.query(`
                    INSERT INTO dbo.SessionTypes (TypeName, Description, IsActive)
                    VALUES ('Wareneinlagerung', 'Eingehende Waren scannen und einlagern - Hauptfunktion', 1)
                `);

                console.log('[SUCCESS] ✅ Wareneinlagerung SessionType direkt eingefügt');
            }
        } catch (verifyError) {
            console.error('[ERROR] Fehler beim Verifizieren von Wareneinlagerung SessionType:', verifyError);
        }

        console.log('[SUCCESS] ✅ SessionTypes Setup erfolgreich abgeschlossen');
        return true;
    } catch (error) {
        console.error('[ERROR] Fehler beim SessionTypes Setup:', error);
        return false;
    }
}

// ===== EXPORTS =====
module.exports = {
    // Constants
    SESSION_TYPES,
    SESSION_TYPE_CONFIG,

    // Helper Functions (Primary)
    createWareneinlagerungSession,
    getWareneinlagerungSessionTypeId,

    // Helper Functions (Legacy)
    createWareneinlagerungSession,
    getWareneinlagerungSessionTypeId,

    // General Helper Functions
    getSessionTypeConfig,
    getAllSessionTypeConfigs,
    isQRTypeAllowedForSession,
    getDefaultSessionDuration,
    validateQRForSessionType,
    getSessionTypeIcon,
    getSessionTypeColor,
    getSessionTypeStatsFilter,

    // Migration Helpers
    createSessionTypesTable,
    insertDefaultSessionTypes,
    setupSessionTypes
};