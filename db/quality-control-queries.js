/**
 * QualityControlQueries - Datenbankoperationen für Qualitätskontrolle
 *
 * Diese Klasse verwaltet alle Datenbankoperationen für das QC-System:
 * - QC-Schritte erstellen, aktualisieren, abfragen
 * - QC-Schema-Management
 * - QC-Statistiken und Berichte
 */

class QualityControlQueries {
    constructor(dbClient) {
        if (!dbClient) {
            throw new Error('DatabaseClient ist erforderlich für QualityControlQueries');
        }

        this.dbClient = dbClient;
        this.tableName = 'QualityControlSteps';
        this.qrScansTable = 'QrScans';
        this.sessionsTable = 'Sessions';
    }

    // ===== SCHEMA MANAGEMENT =====

    /**
     * Erstellt das QC-Datenbankschema falls nicht vorhanden
     * @returns {Promise<boolean>} - Erfolg
     */
    async setupQCSchema() {
        try {
            console.log('🔧 Setup QC-Datenbankschema...');

            // QualityControlSteps Tabelle erstellen
            await this.createQualityControlStepsTable();

            // Indexes erstellen für Performance
            await this.createQCIndexes();

            // QC-Views erstellen
            await this.createQCViews();

            console.log('✅ QC-Schema erfolgreich erstellt');
            return true;

        } catch (error) {
            console.error('❌ QC-Schema Setup fehlgeschlagen:', error);
            return false;
        }
    }

    /**
     * Erstellt die QualityControlSteps Tabelle
     */
    async createQualityControlStepsTable() {
        const createTableSQL = `
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'QualityControlSteps')
            BEGIN
                CREATE TABLE dbo.QualityControlSteps (
                    ID INT IDENTITY(1,1) PRIMARY KEY,
                    SessionID INT NOT NULL,
                    QrCode NVARCHAR(500) NOT NULL,
                    StartScanID INT NULL,
                    EndScanID INT NULL,
                    StartTime DATETIME2 NOT NULL DEFAULT GETDATE(),
                    EndTime DATETIME2 NULL,
                    Completed BIT NOT NULL DEFAULT 0,
                    CreatedTS DATETIME2 NOT NULL DEFAULT GETDATE(),
                    UpdatedTS DATETIME2 NOT NULL DEFAULT GETDATE(),
                    
                    -- Foreign Key Constraints
                    CONSTRAINT FK_QualityControlSteps_Sessions 
                        FOREIGN KEY (SessionID) REFERENCES dbo.Sessions(ID) ON DELETE CASCADE,
                    CONSTRAINT FK_QualityControlSteps_StartScan 
                        FOREIGN KEY (StartScanID) REFERENCES dbo.QrScans(ID),
                    CONSTRAINT FK_QualityControlSteps_EndScan 
                        FOREIGN KEY (EndScanID) REFERENCES dbo.QrScans(ID),
                        
                    -- Check Constraints
                    CONSTRAINT CK_QualityControlSteps_Times
                        CHECK (EndTime IS NULL OR EndTime >= StartTime),
                    CONSTRAINT CK_QualityControlSteps_Completed
                        CHECK ((Completed = 0 AND EndTime IS NULL AND EndScanID IS NULL) OR 
                               (Completed = 1 AND EndTime IS NOT NULL AND EndScanID IS NOT NULL))
                );
                
                PRINT 'QualityControlSteps Tabelle erstellt';
            END
            ELSE
                PRINT 'QualityControlSteps Tabelle bereits vorhanden';
        `;

        await this.dbClient.query(createTableSQL);
    }

    /**
     * Erstellt Performance-Indexes für QC-Tabellen
     */
    async createQCIndexes() {
        const indexes = [
            // Index für Session-basierte Abfragen
            `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_QualityControlSteps_SessionID')
             CREATE NONCLUSTERED INDEX IX_QualityControlSteps_SessionID 
             ON dbo.QualityControlSteps (SessionID) 
             INCLUDE (QrCode, Completed, StartTime, EndTime)`,

            // Index für QR-Code-basierte Abfragen
            `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_QualityControlSteps_QrCode')
             CREATE NONCLUSTERED INDEX IX_QualityControlSteps_QrCode 
             ON dbo.QualityControlSteps (QrCode) 
             INCLUDE (SessionID, Completed, StartTime)`,

            // Index für Completed-Status Abfragen
            `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_QualityControlSteps_Completed_StartTime')
             CREATE NONCLUSTERED INDEX IX_QualityControlSteps_Completed_StartTime 
             ON dbo.QualityControlSteps (Completed, StartTime DESC) 
             INCLUDE (SessionID, QrCode, EndTime)`,

            // Index für Zeitraum-basierte Abfragen
            `IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_QualityControlSteps_StartTime')
             CREATE NONCLUSTERED INDEX IX_QualityControlSteps_StartTime 
             ON dbo.QualityControlSteps (StartTime DESC) 
             INCLUDE (SessionID, QrCode, Completed, EndTime)`
        ];

        for (const indexSQL of indexes) {
            try {
                await this.dbClient.query(indexSQL);
            } catch (error) {
                console.warn('Index-Erstellung fehlgeschlagen (möglicherweise bereits vorhanden):', error.message);
            }
        }
    }

    /**
     * Erstellt nützliche Views für QC-Reporting
     */
    async createQCViews() {
        // View für QC-Schritte mit Session-Details
        const qcStepsWithSessionView = `
            IF OBJECT_ID('dbo.vw_QCStepsWithSession') IS NOT NULL
                DROP VIEW dbo.vw_QCStepsWithSession;
            
            EXEC('CREATE VIEW dbo.vw_QCStepsWithSession AS
            SELECT 
                qcs.ID,
                qcs.SessionID,
                qcs.QrCode,
                qcs.StartScanID,
                qcs.EndScanID,
                qcs.StartTime,
                qcs.EndTime,
                qcs.Completed,
                DATEDIFF(SECOND, qcs.StartTime, ISNULL(qcs.EndTime, GETDATE())) AS DurationSeconds,
                s.UserID,
                s.StartTS AS SessionStart,
                s.SessionType,
                sb.BenutzerName AS UserName,
                sb.Abteilung AS Department
            FROM dbo.QualityControlSteps qcs
            INNER JOIN dbo.Sessions s ON qcs.SessionID = s.ID
            INNER JOIN dbo.ScannBenutzer sb ON s.UserID = sb.ID')
        `;

        // View für tägliche QC-Statistiken
        const dailyQCStatsView = `
            IF OBJECT_ID('dbo.vw_DailyQCStats') IS NOT NULL
                DROP VIEW dbo.vw_DailyQCStats;
            
            EXEC('CREATE VIEW dbo.vw_DailyQCStats AS
            SELECT 
                CAST(StartTime AS DATE) AS Date,
                SessionID,
                UserID,
                UserName,
                COUNT(*) AS TotalSteps,
                SUM(CASE WHEN Completed = 1 THEN 1 ELSE 0 END) AS CompletedSteps,
                SUM(CASE WHEN Completed = 0 THEN 1 ELSE 0 END) AS ActiveSteps,
                AVG(CASE WHEN Completed = 1 THEN DurationSeconds ELSE NULL END) AS AvgDurationSeconds,
                MIN(StartTime) AS FirstStepTime,
                MAX(ISNULL(EndTime, StartTime)) AS LastStepTime
            FROM dbo.vw_QCStepsWithSession
            GROUP BY CAST(StartTime AS DATE), SessionID, UserID, UserName')
        `;

        try {
            await this.dbClient.query(qcStepsWithSessionView);
            await this.dbClient.query(dailyQCStatsView);
            console.log('✅ QC-Views erfolgreich erstellt');
        } catch (error) {
            console.warn('View-Erstellung fehlgeschlagen:', error.message);
        }
    }

    // ===== QC-SCHRITT OPERATIONEN =====

    /**
     * Startet einen neuen QC-Schritt (Eingang-Scan)
     * @param {number} sessionId - Session ID
     * @param {string} qrCode - QR-Code
     * @param {number} startScanId - ID des Start-Scans
     * @returns {Promise<Object|null>} - Neuer QC-Schritt oder null
     */
    async startQCStep(sessionId, qrCode, startScanId) {
        try {
            const insertSQL = `
                INSERT INTO dbo.QualityControlSteps 
                (SessionID, QrCode, StartScanID, StartTime, Completed)
                OUTPUT INSERTED.*
                VALUES (?, ?, ?, GETDATE(), 0)
            `;

            const result = await this.dbClient.query(insertSQL, [sessionId, qrCode, startScanId]);

            if (result.recordset && result.recordset.length > 0) {
                const qcStep = result.recordset[0];
                console.log(`✅ QC-Schritt gestartet: ID ${qcStep.ID}, Session ${sessionId}, QR: ${qrCode}`);
                return qcStep;
            }

            return null;
        } catch (error) {
            console.error('Fehler beim Starten des QC-Schritts:', error);
            throw error;
        }
    }

    /**
     * Schließt einen QC-Schritt ab (Ausgang-Scan)
     * @param {number} sessionId - Session ID
     * @param {string} qrCode - QR-Code
     * @param {number} endScanId - ID des End-Scans
     * @returns {Promise<Object|null>} - Abgeschlossener QC-Schritt oder null
     */
    async completeQCStep(sessionId, qrCode, endScanId) {
        try {
            // Finde den passenden aktiven QC-Schritt
            const findStepSQL = `
                SELECT TOP 1 ID, StartTime
                FROM dbo.QualityControlSteps
                WHERE SessionID = ? AND QrCode = ? AND Completed = 0
                ORDER BY StartTime DESC
            `;

            const findResult = await this.dbClient.query(findStepSQL, [sessionId, qrCode]);

            if (!findResult.recordset || findResult.recordset.length === 0) {
                console.warn(`Kein aktiver QC-Schritt gefunden für Session ${sessionId}, QR: ${qrCode}`);
                return null;
            }

            const stepId = findResult.recordset[0].ID;

            // QC-Schritt abschließen
            const updateSQL = `
                UPDATE dbo.QualityControlSteps
                SET EndScanID = ?, 
                    EndTime = GETDATE(), 
                    Completed = 1,
                    UpdatedTS = GETDATE()
                OUTPUT INSERTED.*
                WHERE ID = ?
            `;

            const updateResult = await this.dbClient.query(updateSQL, [endScanId, stepId]);

            if (updateResult.recordset && updateResult.recordset.length > 0) {
                const completedStep = updateResult.recordset[0];
                console.log(`✅ QC-Schritt abgeschlossen: ID ${stepId}, Dauer: ${this.calculateDurationSeconds(completedStep.StartTime, completedStep.EndTime)}s`);
                return completedStep;
            }

            return null;
        } catch (error) {
            console.error('Fehler beim Abschließen des QC-Schritts:', error);
            throw error;
        }
    }

    /**
     * Bricht alle aktiven QC-Schritte für eine Session ab
     * @param {number} sessionId - Session ID
     * @returns {Promise<number>} - Anzahl abgebrochener Schritte
     */
    async abortActiveStepsForSession(sessionId) {
        try {
            const abortSQL = `
                UPDATE dbo.QualityControlSteps
                SET EndTime = GETDATE(), 
                    Completed = 1,
                    UpdatedTS = GETDATE()
                WHERE SessionID = ? AND Completed = 0
            `;

            const result = await this.dbClient.query(abortSQL, [sessionId]);
            const abortedCount = result.rowsAffected[0] || 0;

            if (abortedCount > 0) {
                console.log(`🚫 ${abortedCount} aktive QC-Schritte für Session ${sessionId} abgebrochen`);
            }

            return abortedCount;
        } catch (error) {
            console.error('Fehler beim Abbrechen der QC-Schritte:', error);
            throw error;
        }
    }

    // ===== ABFRAGE-OPERATIONEN =====

    /**
     * Holt aktive QC-Schritte für eine Session
     * @param {number} sessionId - Session ID
     * @returns {Promise<Array>} - Array von aktiven QC-Schritten
     */
    async getActiveQCStepsForSession(sessionId) {
        try {
            const selectSQL = `
                SELECT 
                    qcs.*,
                    DATEDIFF(SECOND, qcs.StartTime, GETDATE()) AS DurationSeconds
                FROM dbo.QualityControlSteps qcs
                WHERE qcs.SessionID = ? AND qcs.Completed = 0
                ORDER BY qcs.StartTime DESC
            `;

            const result = await this.dbClient.query(selectSQL, [sessionId]);
            return result.recordset || [];
        } catch (error) {
            console.error('Fehler beim Abrufen aktiver QC-Schritte:', error);
            return [];
        }
    }

    /**
     * Holt heute abgeschlossene QC-Schritte für eine Session
     * @param {number} sessionId - Session ID
     * @returns {Promise<Array>} - Array von heute abgeschlossenen QC-Schritten
     */
    async getCompletedQCStepsToday(sessionId) {
        try {
            const selectSQL = `
                SELECT 
                    qcs.*,
                    DATEDIFF(SECOND, qcs.StartTime, qcs.EndTime) AS DurationSeconds
                FROM dbo.QualityControlSteps qcs
                WHERE qcs.SessionID = ? 
                  AND qcs.Completed = 1
                  AND CAST(qcs.StartTime AS DATE) = CAST(GETDATE() AS DATE)
                ORDER BY qcs.EndTime DESC
            `;

            const result = await this.dbClient.query(selectSQL, [sessionId]);
            return result.recordset || [];
        } catch (error) {
            console.error('Fehler beim Abrufen heutiger QC-Schritte:', error);
            return [];
        }
    }

    /**
     * Holt QC-Schritt Details anhand der ID
     * @param {number} stepId - QC-Schritt ID
     * @returns {Promise<Object|null>} - QC-Schritt Details oder null
     */
    async getQCStepDetails(stepId) {
        try {
            const selectSQL = `
                SELECT 
                    qcs.*,
                    DATEDIFF(SECOND, qcs.StartTime, ISNULL(qcs.EndTime, GETDATE())) AS DurationSeconds,
                    s.UserID,
                    sb.BenutzerName AS UserName,
                    sb.Abteilung AS Department,
                    startScan.CapturedTS AS StartScanTime,
                    endScan.CapturedTS AS EndScanTime
                FROM dbo.QualityControlSteps qcs
                INNER JOIN dbo.Sessions s ON qcs.SessionID = s.ID
                INNER JOIN dbo.ScannBenutzer sb ON s.UserID = sb.ID
                LEFT JOIN dbo.QrScans startScan ON qcs.StartScanID = startScan.ID
                LEFT JOIN dbo.QrScans endScan ON qcs.EndScanID = endScan.ID
                WHERE qcs.ID = ?
            `;

            const result = await this.dbClient.query(selectSQL, [stepId]);

            if (result.recordset && result.recordset.length > 0) {
                return result.recordset[0];
            }

            return null;
        } catch (error) {
            console.error('Fehler beim Abrufen der QC-Schritt Details:', error);
            return null;
        }
    }

    /**
     * Sucht QC-Schritte nach QR-Code
     * @param {string} qrCode - QR-Code zum Suchen
     * @param {number|null} sessionId - Optional: Nur in bestimmter Session suchen
     * @param {number} limit - Maximale Anzahl Ergebnisse
     * @returns {Promise<Array>} - Array von gefundenen QC-Schritten
     */
    async searchQCStepsByQRCode(qrCode, sessionId = null, limit = 20) {
        try {
            let whereClause = 'WHERE qcs.QrCode LIKE ?';
            let params = [`%${qrCode}%`];

            if (sessionId) {
                whereClause += ' AND qcs.SessionID = ?';
                params.push(sessionId);
            }

            const selectSQL = `
                SELECT TOP (${limit})
                    qcs.*,
                    DATEDIFF(SECOND, qcs.StartTime, ISNULL(qcs.EndTime, GETDATE())) AS DurationSeconds,
                    s.UserID,
                    sb.BenutzerName AS UserName
                FROM dbo.QualityControlSteps qcs
                INNER JOIN dbo.Sessions s ON qcs.SessionID = s.ID
                INNER JOIN dbo.ScannBenutzer sb ON s.UserID = sb.ID
                ${whereClause}
                ORDER BY qcs.StartTime DESC
            `;

            const result = await this.dbClient.query(selectSQL, params);
            return result.recordset || [];
        } catch (error) {
            console.error('Fehler bei QC-Schritt-Suche:', error);
            return [];
        }
    }

    // ===== STATISTIK-OPERATIONEN =====

    /**
     * Holt QC-Statistiken für eine Session
     * @param {number} sessionId - Session ID
     * @returns {Promise<Object>} - QC-Statistiken
     */
    async getQCStatsForSession(sessionId) {
        try {
            const statsSQL = `
                SELECT 
                    COUNT(*) AS TotalSteps,
                    SUM(CASE WHEN Completed = 1 THEN 1 ELSE 0 END) AS CompletedSteps,
                    SUM(CASE WHEN Completed = 0 THEN 1 ELSE 0 END) AS ActiveSteps,
                    AVG(CASE WHEN Completed = 1 THEN DATEDIFF(SECOND, StartTime, EndTime) ELSE NULL END) AS AvgDurationSeconds,
                    MIN(StartTime) AS FirstStepTime,
                    MAX(ISNULL(EndTime, StartTime)) AS LastStepTime
                FROM dbo.QualityControlSteps
                WHERE SessionID = ?
            `;

            const result = await this.dbClient.query(statsSQL, [sessionId]);

            if (result.recordset && result.recordset.length > 0) {
                return result.recordset[0];
            }

            return {
                TotalSteps: 0,
                CompletedSteps: 0,
                ActiveSteps: 0,
                AvgDurationSeconds: null,
                FirstStepTime: null,
                LastStepTime: null
            };
        } catch (error) {
            console.error('Fehler beim Abrufen der QC-Session-Statistiken:', error);
            return {};
        }
    }

    /**
     * Holt Anzahl heute abgeschlossener QC-Schritte (alle Sessions)
     * @returns {Promise<number>} - Anzahl abgeschlossener QC-Schritte heute
     */
    async getCompletedQCStepsCountToday() {
        try {
            const countSQL = `
                SELECT COUNT(*) AS CompletedToday
                FROM dbo.QualityControlSteps
                WHERE Completed = 1
                  AND CAST(EndTime AS DATE) = CAST(GETDATE() AS DATE)
            `;

            const result = await this.dbClient.query(countSQL);

            if (result.recordset && result.recordset.length > 0) {
                return result.recordset[0].CompletedToday || 0;
            }

            return 0;
        } catch (error) {
            console.error('Fehler beim Abrufen der heutigen QC-Schritte-Anzahl:', error);
            return 0;
        }
    }

    /**
     * Holt tägliche QC-Statistiken
     * @param {number} days - Anzahl Tage zurück (Standard: 7)
     * @returns {Promise<Array>} - Array von täglichen Statistiken
     */
    async getDailyQCStats(days = 7) {
        try {
            const statsSQL = `
                SELECT 
                    CAST(StartTime AS DATE) AS Date,
                    COUNT(*) AS TotalSteps,
                    SUM(CASE WHEN Completed = 1 THEN 1 ELSE 0 END) AS CompletedSteps,
                    SUM(CASE WHEN Completed = 0 THEN 1 ELSE 0 END) AS ActiveSteps,
                    COUNT(DISTINCT SessionID) AS UniqueSessions,
                    AVG(CASE WHEN Completed = 1 THEN DATEDIFF(SECOND, StartTime, EndTime) ELSE NULL END) AS AvgDurationSeconds
                FROM dbo.QualityControlSteps
                WHERE StartTime >= DATEADD(DAY, -?, CAST(GETDATE() AS DATE))
                GROUP BY CAST(StartTime AS DATE)
                ORDER BY CAST(StartTime AS DATE) DESC
            `;

            const result = await this.dbClient.query(statsSQL, [days]);
            return result.recordset || [];
        } catch (error) {
            console.error('Fehler beim Abrufen der täglichen QC-Statistiken:', error);
            return [];
        }
    }

    /**
     * Holt QC-Performance-Metriken pro Benutzer
     * @param {number} days - Anzahl Tage zurück (Standard: 30)
     * @returns {Promise<Array>} - Array von Benutzer-Performance-Daten
     */
    async getUserQCPerformance(days = 30) {
        try {
            const performanceSQL = `
                SELECT 
                    sb.ID AS UserID,
                    sb.BenutzerName AS UserName,
                    sb.Abteilung AS Department,
                    COUNT(*) AS TotalSteps,
                    SUM(CASE WHEN qcs.Completed = 1 THEN 1 ELSE 0 END) AS CompletedSteps,
                    SUM(CASE WHEN qcs.Completed = 0 THEN 1 ELSE 0 END) AS ActiveSteps,
                    AVG(CASE WHEN qcs.Completed = 1 THEN DATEDIFF(SECOND, qcs.StartTime, qcs.EndTime) ELSE NULL END) AS AvgDurationSeconds,
                    MIN(qcs.StartTime) AS FirstStepTime,
                    MAX(ISNULL(qcs.EndTime, qcs.StartTime)) AS LastStepTime,
                    COUNT(DISTINCT CAST(qcs.StartTime AS DATE)) AS ActiveDays
                FROM dbo.QualityControlSteps qcs
                INNER JOIN dbo.Sessions s ON qcs.SessionID = s.ID
                INNER JOIN dbo.ScannBenutzer sb ON s.UserID = sb.ID
                WHERE qcs.StartTime >= DATEADD(DAY, -?, CAST(GETDATE() AS DATE))
                GROUP BY sb.ID, sb.BenutzerName, sb.Abteilung
                ORDER BY CompletedSteps DESC, AvgDurationSeconds ASC
            `;

            const result = await this.dbClient.query(performanceSQL, [days]);
            return result.recordset || [];
        } catch (error) {
            console.error('Fehler beim Abrufen der QC-Benutzer-Performance:', error);
            return [];
        }
    }

    // ===== CLEANUP OPERATIONEN =====

    /**
     * Bereinigt alte QC-Schritte (älter als X Tage)
     * @param {number} retentionDays - Aufbewahrungsdauer in Tagen (Standard: 90)
     * @returns {Promise<number>} - Anzahl gelöschter Schritte
     */
    async cleanupOldQCSteps(retentionDays = 90) {
        try {
            const deleteSQL = `
                DELETE FROM dbo.QualityControlSteps
                WHERE StartTime < DATEADD(DAY, -?, CAST(GETDATE() AS DATE))
                  AND Completed = 1
            `;

            const result = await this.dbClient.query(deleteSQL, [retentionDays]);
            const deletedCount = result.rowsAffected[0] || 0;

            if (deletedCount > 0) {
                console.log(`🧹 ${deletedCount} alte QC-Schritte gelöscht (älter als ${retentionDays} Tage)`);
            }

            return deletedCount;
        } catch (error) {
            console.error('Fehler beim Bereinigen alter QC-Schritte:', error);
            return 0;
        }
    }

    // ===== HILFSFUNKTIONEN =====

    /**
     * Berechnet die Dauer zwischen zwei Zeitstempeln in Sekunden
     * @param {Date|string} startTime - Start-Zeit
     * @param {Date|string} endTime - End-Zeit
     * @returns {number} - Dauer in Sekunden
     */
    calculateDurationSeconds(startTime, endTime) {
        try {
            const start = new Date(startTime);
            const end = new Date(endTime);
            return Math.floor((end.getTime() - start.getTime()) / 1000);
        } catch (error) {
            return 0;
        }
    }

    /**
     * Prüft ob ein QC-Schritt für den gegebenen QR-Code bereits aktiv ist
     * @param {number} sessionId - Session ID
     * @param {string} qrCode - QR-Code
     * @returns {Promise<boolean>} - True wenn bereits aktiv
     */
    async hasActiveStepForQRCode(sessionId, qrCode) {
        try {
            const checkSQL = `
                SELECT COUNT(*) AS ActiveCount
                FROM dbo.QualityControlSteps
                WHERE SessionID = ? AND QrCode = ? AND Completed = 0
            `;

            const result = await this.dbClient.query(checkSQL, [sessionId, qrCode]);

            if (result.recordset && result.recordset.length > 0) {
                return result.recordset[0].ActiveCount > 0;
            }

            return false;
        } catch (error) {
            console.error('Fehler beim Prüfen aktiver QC-Schritte:', error);
            return false;
        }
    }

    /**
     * Holt QC-Schritt anhand QR-Code und Session (neuester zuerst)
     * @param {number} sessionId - Session ID
     * @param {string} qrCode - QR-Code
     * @returns {Promise<Object|null>} - QC-Schritt oder null
     */
    async getLatestQCStepForQRCode(sessionId, qrCode) {
        try {
            const selectSQL = `
                SELECT TOP 1 *
                FROM dbo.QualityControlSteps
                WHERE SessionID = ? AND QrCode = ?
                ORDER BY StartTime DESC
            `;

            const result = await this.dbClient.query(selectSQL, [sessionId, qrCode]);

            if (result.recordset && result.recordset.length > 0) {
                return result.recordset[0];
            }

            return null;
        } catch (error) {
            console.error('Fehler beim Abrufen des neuesten QC-Schritts:', error);
            return null;
        }
    }

    // ===== REPORTING & EXPORT =====

    /**
     * Erstellt einen QC-Bericht für einen Zeitraum
     * @param {Date} startDate - Start-Datum
     * @param {Date} endDate - End-Datum
     * @param {number|null} userId - Optional: Nur für bestimmten Benutzer
     * @returns {Promise<Object>} - QC-Bericht
     */
    async generateQCReport(startDate, endDate, userId = null) {
        try {
            let userFilter = '';
            let params = [startDate, endDate];

            if (userId) {
                userFilter = 'AND s.UserID = ?';
                params.push(userId);
            }

            const reportSQL = `
                SELECT 
                    -- Zusammenfassung
                    COUNT(*) AS TotalSteps,
                    SUM(CASE WHEN qcs.Completed = 1 THEN 1 ELSE 0 END) AS CompletedSteps,
                    SUM(CASE WHEN qcs.Completed = 0 THEN 1 ELSE 0 END) AS ActiveSteps,
                    
                    -- Zeiten
                    AVG(CASE WHEN qcs.Completed = 1 THEN DATEDIFF(SECOND, qcs.StartTime, qcs.EndTime) ELSE NULL END) AS AvgDurationSeconds,
                    MIN(CASE WHEN qcs.Completed = 1 THEN DATEDIFF(SECOND, qcs.StartTime, qcs.EndTime) ELSE NULL END) AS MinDurationSeconds,
                    MAX(CASE WHEN qcs.Completed = 1 THEN DATEDIFF(SECOND, qcs.StartTime, qcs.EndTime) ELSE NULL END) AS MaxDurationSeconds,
                    
                    -- Benutzer
                    COUNT(DISTINCT s.UserID) AS UniqueUsers,
                    COUNT(DISTINCT qcs.SessionID) AS UniqueSessions,
                    
                    -- QR-Codes
                    COUNT(DISTINCT qcs.QrCode) AS UniqueQRCodes
                    
                FROM dbo.QualityControlSteps qcs
                INNER JOIN dbo.Sessions s ON qcs.SessionID = s.ID
                WHERE qcs.StartTime >= ? AND qcs.StartTime < ?
                ${userFilter}
            `;

            const result = await this.dbClient.query(reportSQL, params);

            if (result.recordset && result.recordset.length > 0) {
                const summary = result.recordset[0];

                // Zusätzliche Details holen
                const dailyBreakdown = await this.getDailyQCBreakdown(startDate, endDate, userId);
                const topUsers = await this.getTopQCUsers(startDate, endDate, 10);

                return {
                    reportPeriod: {
                        startDate: startDate,
                        endDate: endDate,
                        userId: userId
                    },
                    summary: summary,
                    dailyBreakdown: dailyBreakdown,
                    topUsers: topUsers,
                    generatedAt: new Date().toISOString()
                };
            }

            return {};
        } catch (error) {
            console.error('Fehler beim Erstellen des QC-Berichts:', error);
            throw error;
        }
    }

    /**
     * Holt tägliche QC-Aufschlüsselung für Bericht
     */
    async getDailyQCBreakdown(startDate, endDate, userId = null) {
        try {
            let userFilter = '';
            let params = [startDate, endDate];

            if (userId) {
                userFilter = 'AND s.UserID = ?';
                params.push(userId);
            }

            const breakdownSQL = `
                SELECT 
                    CAST(qcs.StartTime AS DATE) AS Date,
                    COUNT(*) AS TotalSteps,
                    SUM(CASE WHEN qcs.Completed = 1 THEN 1 ELSE 0 END) AS CompletedSteps,
                    AVG(CASE WHEN qcs.Completed = 1 THEN DATEDIFF(SECOND, qcs.StartTime, qcs.EndTime) ELSE NULL END) AS AvgDurationSeconds,
                    COUNT(DISTINCT s.UserID) AS ActiveUsers
                FROM dbo.QualityControlSteps qcs
                INNER JOIN dbo.Sessions s ON qcs.SessionID = s.ID
                WHERE qcs.StartTime >= ? AND qcs.StartTime < ?
                ${userFilter}
                GROUP BY CAST(qcs.StartTime AS DATE)
                ORDER BY CAST(qcs.StartTime AS DATE)
            `;

            const result = await this.dbClient.query(breakdownSQL, params);
            return result.recordset || [];
        } catch (error) {
            console.error('Fehler beim Abrufen der täglichen QC-Aufschlüsselung:', error);
            return [];
        }
    }

    /**
     * Holt Top-QC-Benutzer für Bericht
     */
    async getTopQCUsers(startDate, endDate, limit = 10) {
        try {
            const topUsersSQL = `
                SELECT TOP (${limit})
                    sb.BenutzerName AS UserName,
                    sb.Abteilung AS Department,
                    COUNT(*) AS TotalSteps,
                    SUM(CASE WHEN qcs.Completed = 1 THEN 1 ELSE 0 END) AS CompletedSteps,
                    AVG(CASE WHEN qcs.Completed = 1 THEN DATEDIFF(SECOND, qcs.StartTime, qcs.EndTime) ELSE NULL END) AS AvgDurationSeconds,
                    COUNT(DISTINCT qcs.QrCode) AS UniqueQRCodes
                FROM dbo.QualityControlSteps qcs
                INNER JOIN dbo.Sessions s ON qcs.SessionID = s.ID
                INNER JOIN dbo.ScannBenutzer sb ON s.UserID = sb.ID
                WHERE qcs.StartTime >= ? AND qcs.StartTime < ?
                GROUP BY sb.ID, sb.BenutzerName, sb.Abteilung
                ORDER BY CompletedSteps DESC, AvgDurationSeconds ASC
            `;

            const result = await this.dbClient.query(topUsersSQL, [startDate, endDate]);
            return result.recordset || [];
        } catch (error) {
            console.error('Fehler beim Abrufen der Top-QC-Benutzer:', error);
            return [];
        }
    }
}

module.exports = QualityControlQueries;