/**
 * QualityControlLogic - Geschäftslogik für Qualitätskontrolle
 *
 * Diese Klasse implementiert die spezifische Logik für Qualitätskontrollprozesse:
 * - Zweifach-Scan-Workflow (Eingang → Ausgang)
 * - QC-Schritt-Management
 * - Validierung und Fehlerbehandlung
 * - Integration mit QualityControlQueries
 */

class QualityControlLogic {
    constructor(dbClient, qualityControlQueries) {
        if (!dbClient) {
            throw new Error('DatabaseClient ist erforderlich für QualityControlLogic');
        }

        if (!qualityControlQueries) {
            throw new Error('QualityControlQueries ist erforderlich für QualityControlLogic');
        }

        this.dbClient = dbClient;
        this.qcQueries = qualityControlQueries;

        // QC-spezifische Konfiguration
        this.config = {
            maxParallelStepsPerSession: parseInt(process.env.QC_MAX_PARALLEL_STEPS_PER_SESSION) || 10,
            stepTimeoutMinutes: parseInt(process.env.QC_STEP_TIMEOUT_MINUTES) || 120,
            requireBothScans: process.env.QC_REQUIRE_BOTH_SCANS !== 'false',
            autoAbortOnSessionEnd: process.env.QC_AUTO_ABORT_ON_SESSION_END !== 'false',
            enableAuditLog: process.env.QC_ENABLE_AUDIT_LOG !== 'false',
            defaultPriority: parseInt(process.env.QC_DEFAULT_PRIORITY) || 1,
            allowRework: process.env.QC_ALLOW_REWORK !== 'false'
        };

        // In-Memory Tracking für Performance
        this.activeStepsCache = new Map(); // sessionId -> Set von QC-Step-IDs
        this.scanStateCache = new Map(); // sessionId -> { expectedScan, currentQRCode, lastScanTime }

        console.log('QualityControlLogic initialisiert mit Konfiguration:', this.config);
    }

    // ===== HAUPTEINGANGSPUNKT FÜR QR-SCANS =====

    /**
     * Verarbeitet einen QR-Scan für Qualitätskontrolle
     * Entscheidet automatisch zwischen Eingang- und Ausgang-Scan
     * @param {number} sessionId - Session ID
     * @param {string} qrCode - QR-Code
     * @param {number} scanId - ID des QR-Scans aus der Datenbank
     * @returns {Promise<Object>} - Verarbeitungsergebnis
     */
    async processQRScan(sessionId, qrCode, scanId) {
        try {
            console.log(`🔍 QC-QR-Scan-Verarbeitung: Session ${sessionId}, QR: ${qrCode}`);

            // Prüfe ob Session gültig ist
            const session = await this.validateSession(sessionId);
            if (!session.isValid) {
                throw new Error(`Ungültige Session: ${session.message}`);
            }

            // Prüfe aktuellen Status für diesen QR-Code in dieser Session
            const existingStep = await this.qcQueries.getLatestQCStepForQRCode(sessionId, qrCode);

            if (existingStep && !existingStep.Completed) {
                // Aktiver Schritt vorhanden → Ausgang-Scan
                return await this.processExitScan(sessionId, qrCode, scanId, existingStep);
            } else {
                // Kein aktiver Schritt → Eingang-Scan
                return await this.processEntranceScan(sessionId, qrCode, scanId);
            }

        } catch (error) {
            console.error('Fehler bei QC-QR-Scan-Verarbeitung:', error);
            return {
                success: false,
                type: 'error',
                message: `QC-Verarbeitungsfehler: ${error.message}`,
                qcStep: null,
                scanType: 'unknown'
            };
        }
    }

    /**
     * Verarbeitet Eingang-Scan (Start eines QC-Schritts)
     * @param {number} sessionId - Session ID
     * @param {string} qrCode - QR-Code
     * @param {number} scanId - ID des QR-Scans
     * @returns {Promise<Object>} - Verarbeitungsergebnis
     */
    async processEntranceScan(sessionId, qrCode, scanId) {
        try {
            console.log(`📥 QC-Eingang-Scan: Session ${sessionId}, QR: ${qrCode}`);

            // Prüfe ob zu viele parallele Schritte
            const activeStepsCount = await this.getActiveStepsCount(sessionId);
            if (activeStepsCount >= this.config.maxParallelStepsPerSession) {
                return {
                    success: false,
                    type: 'limit_exceeded',
                    message: `Maximale Anzahl paralleler QC-Schritte erreicht (${this.config.maxParallelStepsPerSession})`,
                    qcStep: null,
                    scanType: 'entrance',
                    activeStepsCount: activeStepsCount
                };
            }

            // Prüfe auf bereits abgeschlossenen QC-Schritt für diesen QR-Code heute
            const completedToday = await this.qcQueries.getCompletedQCStepsToday(sessionId);
            const alreadyCompletedToday = completedToday.some(step => step.QrCode === qrCode);

            if (alreadyCompletedToday) {
                return {
                    success: false,
                    type: 'already_completed',
                    message: `QC-Schritt für diesen QR-Code heute bereits abgeschlossen`,
                    qcStep: null,
                    scanType: 'entrance'
                };
            }

            // QC-Schritt starten
            const qcStep = await this.startQCStep(sessionId, qrCode, scanId);

            if (qcStep) {
                // Cache aktualisieren
                this.updateActiveStepsCache(sessionId, qcStep.ID, 'add');
                this.updateScanStateCache(sessionId, {
                    expectedScan: 'exit',
                    currentQRCode: qrCode,
                    lastScanTime: new Date()
                });

                return {
                    success: true,
                    type: 'entrance_started',
                    message: 'QC-Schritt gestartet - bereit für Ausgang-Scan',
                    qcStep: qcStep,
                    scanType: 'entrance',
                    nextExpectedScan: 'exit'
                };
            } else {
                throw new Error('QC-Schritt konnte nicht gestartet werden');
            }

        } catch (error) {
            console.error('Fehler beim QC-Eingang-Scan:', error);
            return {
                success: false,
                type: 'entrance_error',
                message: `Eingang-Scan fehlgeschlagen: ${error.message}`,
                qcStep: null,
                scanType: 'entrance'
            };
        }
    }

    /**
     * Verarbeitet Ausgang-Scan (Abschluss eines QC-Schritts)
     * @param {number} sessionId - Session ID
     * @param {string} qrCode - QR-Code
     * @param {number} scanId - ID des QR-Scans
     * @param {Object} existingStep - Bestehender QC-Schritt
     * @returns {Promise<Object>} - Verarbeitungsergebnis
     */
    async processExitScan(sessionId, qrCode, scanId, existingStep) {
        try {
            console.log(`📤 QC-Ausgang-Scan: Session ${sessionId}, QR: ${qrCode}, Step ID: ${existingStep.ID}`);

            // Prüfe ob QR-Code übereinstimmt
            if (existingStep.QrCode !== qrCode) {
                return {
                    success: false,
                    type: 'qr_mismatch',
                    message: `QR-Code stimmt nicht mit aktivem Schritt überein`,
                    qcStep: existingStep,
                    scanType: 'exit',
                    expectedQRCode: existingStep.QrCode,
                    actualQRCode: qrCode
                };
            }

            // Prüfe auf Timeout
            const stepDurationMinutes = this.calculateStepDurationMinutes(existingStep.StartTime);
            if (stepDurationMinutes > this.config.stepTimeoutMinutes) {
                console.warn(`QC-Schritt ${existingStep.ID} überschreitet Timeout (${stepDurationMinutes} min > ${this.config.stepTimeoutMinutes} min)`);
            }

            // QC-Schritt abschließen
            const completedStep = await this.completeQCStep(sessionId, qrCode, scanId);

            if (completedStep) {
                // Cache aktualisieren
                this.updateActiveStepsCache(sessionId, completedStep.ID, 'remove');
                this.updateScanStateCache(sessionId, {
                    expectedScan: 'entrance',
                    currentQRCode: null,
                    lastScanTime: new Date()
                });

                const durationSeconds = this.calculateStepDurationSeconds(completedStep.StartTime, completedStep.EndTime);

                return {
                    success: true,
                    type: 'exit_completed',
                    message: `QC-Schritt abgeschlossen (${this.formatDuration(durationSeconds)})`,
                    qcStep: completedStep,
                    scanType: 'exit',
                    durationSeconds: durationSeconds,
                    nextExpectedScan: 'entrance'
                };
            } else {
                throw new Error('QC-Schritt konnte nicht abgeschlossen werden');
            }

        } catch (error) {
            console.error('Fehler beim QC-Ausgang-Scan:', error);
            return {
                success: false,
                type: 'exit_error',
                message: `Ausgang-Scan fehlgeschlagen: ${error.message}`,
                qcStep: existingStep,
                scanType: 'exit'
            };
        }
    }

    // ===== QC-SCHRITT MANAGEMENT =====

    /**
     * Startet einen neuen QC-Schritt
     * @param {number} sessionId - Session ID
     * @param {string} qrCode - QR-Code
     * @param {number} startScanId - ID des Start-Scans
     * @param {Object} options - Zusätzliche Optionen
     * @returns {Promise<Object|null>} - QC-Schritt oder null
     */
    async startQCStep(sessionId, qrCode, startScanId, options = {}) {
        try {
            const priority = options.priority || this.config.defaultPriority;

            // Verwende Stored Procedure falls verfügbar, sonst direkte Query
            if (await this.hasStoredProcedure('sp_StartQCStep')) {
                const result = await this.dbClient.query(`
                    EXEC sp_StartQCStep @SessionID = ?, @QrCode = ?, @StartScanID = ?, @Priority = ?
                `, [sessionId, qrCode, startScanId, priority]);

                return result.recordset && result.recordset.length > 0 ? result.recordset[0] : null;
            } else {
                // Fallback auf QualityControlQueries
                return await this.qcQueries.startQCStep(sessionId, qrCode, startScanId);
            }

        } catch (error) {
            console.error('Fehler beim Starten des QC-Schritts:', error);
            throw error;
        }
    }

    /**
     * Schließt einen QC-Schritt ab
     * @param {number} sessionId - Session ID
     * @param {string} qrCode - QR-Code
     * @param {number} endScanId - ID des End-Scans
     * @param {Object} qualityData - Qualitätsdaten (optional)
     * @returns {Promise<Object|null>} - Abgeschlossener QC-Schritt oder null
     */
    async completeQCStep(sessionId, qrCode, endScanId, qualityData = {}) {
        try {
            // Verwende Stored Procedure falls verfügbar
            if (await this.hasStoredProcedure('sp_CompleteQCStep')) {
                const result = await this.dbClient.query(`
                    EXEC sp_CompleteQCStep 
                        @SessionID = ?, 
                        @QrCode = ?, 
                        @EndScanID = ?,
                        @QualityRating = ?,
                        @DefectsFound = ?,
                        @DefectDescription = ?,
                        @QualityNotes = ?
                `, [
                    sessionId,
                    qrCode,
                    endScanId,
                    qualityData.rating || null,
                    qualityData.defectsFound || false,
                    qualityData.defectDescription || null,
                    qualityData.notes || null
                ]);

                return result.recordset && result.recordset.length > 0 ? result.recordset[0] : null;
            } else {
                // Fallback auf QualityControlQueries
                return await this.qcQueries.completeQCStep(sessionId, qrCode, endScanId);
            }

        } catch (error) {
            console.error('Fehler beim Abschließen des QC-Schritts:', error);
            throw error;
        }
    }

    /**
     * Bricht alle aktiven QC-Schritte für eine Session ab
     * @param {number} sessionId - Session ID
     * @param {string} reason - Grund für Abbruch (optional)
     * @returns {Promise<number>} - Anzahl abgebrochener Schritte
     */
    async abortActiveStepsForSession(sessionId, reason = 'Session beendet') {
        try {
            console.log(`🚫 Breche aktive QC-Schritte für Session ${sessionId} ab: ${reason}`);

            let abortedCount = 0;

            // Verwende Stored Procedure falls verfügbar
            if (await this.hasStoredProcedure('sp_AbortActiveQCSteps')) {
                const result = await this.dbClient.query(`
                    EXEC sp_AbortActiveQCSteps @SessionID = ?, @AbortReason = ?
                `, [sessionId, reason]);

                abortedCount = result.recordset[0]?.AbortedStepsCount || 0;
            } else {
                // Fallback auf QualityControlQueries
                abortedCount = await this.qcQueries.abortActiveStepsForSession(sessionId);
            }

            // Cache bereinigen
            this.clearSessionFromCache(sessionId);

            console.log(`✅ ${abortedCount} QC-Schritte für Session ${sessionId} abgebrochen`);
            return abortedCount;

        } catch (error) {
            console.error('Fehler beim Abbrechen der QC-Schritte:', error);
            throw error;
        }
    }

    /**
     * Bricht einen spezifischen QC-Schritt ab
     * @param {number} qcStepId - QC-Schritt ID
     * @param {string} reason - Grund für Abbruch
     * @returns {Promise<boolean>} - Erfolg
     */
    async abortQCStep(qcStepId, reason = 'Manuell abgebrochen') {
        try {
            const updateResult = await this.dbClient.query(`
                UPDATE QualityControlSteps
                SET QCStatus = 'aborted',
                    EndTime = GETDATE(),
                    QualityNotes = COALESCE(QualityNotes + ' | ', '') + ?,
                    UpdatedTS = GETDATE()
                WHERE ID = ? AND QCStatus = 'active'
            `, [reason, qcStepId]);

            const success = updateResult.rowsAffected[0] > 0;

            if (success) {
                console.log(`✅ QC-Schritt ${qcStepId} abgebrochen: ${reason}`);

                // Cache aktualisieren
                this.removeStepFromCache(qcStepId);

                // Audit-Log (falls aktiviert)
                if (this.config.enableAuditLog) {
                    await this.logAuditEvent(qcStepId, 'aborted', { reason: reason });
                }
            }

            return success;

        } catch (error) {
            console.error('Fehler beim Abbrechen des QC-Schritts:', error);
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
            return await this.qcQueries.getActiveQCStepsForSession(sessionId);
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
            return await this.qcQueries.getCompletedQCStepsToday(sessionId);
        } catch (error) {
            console.error('Fehler beim Abrufen heutiger QC-Schritte:', error);
            return [];
        }
    }

    /**
     * Holt QC-Schritt Details
     * @param {number} stepId - QC-Schritt ID
     * @returns {Promise<Object|null>} - QC-Schritt Details oder null
     */
    async getQCStepDetails(stepId) {
        try {
            return await this.qcQueries.getQCStepDetails(stepId);
        } catch (error) {
            console.error('Fehler beim Abrufen der QC-Schritt Details:', error);
            return null;
        }
    }

    /**
     * Holt QC-Statistiken für eine Session
     * @param {number} sessionId - Session ID
     * @returns {Promise<Object>} - QC-Statistiken
     */
    async getQCStatsForSession(sessionId) {
        try {
            return await this.qcQueries.getQCStatsForSession(sessionId);
        } catch (error) {
            console.error('Fehler beim Abrufen der QC-Session-Statistiken:', error);
            return {};
        }
    }

    // ===== VALIDIERUNG =====

    /**
     * Validiert eine Session für QC-Operationen
     * @param {number} sessionId - Session ID
     * @returns {Promise<Object>} - Validierungsergebnis
     */
    async validateSession(sessionId) {
        try {
            // Session aus Datenbank abrufen
            const session = await this.dbClient.getSessionWithType(sessionId);

            if (!session) {
                return {
                    isValid: false,
                    message: 'Session nicht gefunden',
                    session: null
                };
            }

            if (!session.Active) {
                return {
                    isValid: false,
                    message: 'Session ist nicht aktiv',
                    session: session
                };
            }

            // Optionale Validierung für QC-SessionType
            if (session.SessionTypeName && session.SessionTypeName !== 'Qualitätskontrolle') {
                console.warn(`Session ${sessionId} hat SessionType '${session.SessionTypeName}' statt 'Qualitätskontrolle'`);
            }

            return {
                isValid: true,
                message: 'Session gültig',
                session: session
            };

        } catch (error) {
            return {
                isValid: false,
                message: `Session-Validierung fehlgeschlagen: ${error.message}`,
                session: null
            };
        }
    }

    /**
     * Validiert QR-Code für QC-Operationen
     * @param {string} qrCode - QR-Code
     * @returns {Object} - Validierungsergebnis
     */
    validateQRCode(qrCode) {
        if (!qrCode || typeof qrCode !== 'string') {
            return {
                isValid: false,
                message: 'QR-Code ist leer oder ungültig'
            };
        }

        const trimmedCode = qrCode.trim();

        if (trimmedCode.length < 5) {
            return {
                isValid: false,
                message: 'QR-Code zu kurz (mindestens 5 Zeichen)'
            };
        }

        if (trimmedCode.length > 500) {
            return {
                isValid: false,
                message: 'QR-Code zu lang (maximal 500 Zeichen)'
            };
        }

        // Grundlegende Format-Prüfung (kann erweitert werden)
        if (!/^[a-zA-Z0-9\-_^:;.,\s]+$/.test(trimmedCode)) {
            return {
                isValid: false,
                message: 'QR-Code enthält ungültige Zeichen'
            };
        }

        return {
            isValid: true,
            message: 'QR-Code gültig',
            normalizedCode: trimmedCode
        };
    }

    // ===== CACHE MANAGEMENT =====

    /**
     * Aktualisiert den Cache für aktive QC-Schritte
     * @param {number} sessionId - Session ID
     * @param {number} stepId - QC-Schritt ID
     * @param {string} action - 'add' oder 'remove'
     */
    updateActiveStepsCache(sessionId, stepId, action) {
        try {
            if (!this.activeStepsCache.has(sessionId)) {
                this.activeStepsCache.set(sessionId, new Set());
            }

            const stepsSet = this.activeStepsCache.get(sessionId);

            if (action === 'add') {
                stepsSet.add(stepId);
            } else if (action === 'remove') {
                stepsSet.delete(stepId);
            }

        } catch (error) {
            console.warn('Fehler beim Cache-Update:', error);
        }
    }

    /**
     * Aktualisiert den Scan-State-Cache
     * @param {number} sessionId - Session ID
     * @param {Object} scanState - Neuer Scan-State
     */
    updateScanStateCache(sessionId, scanState) {
        try {
            this.scanStateCache.set(sessionId, {
                ...scanState,
                lastUpdated: new Date()
            });
        } catch (error) {
            console.warn('Fehler beim Scan-State-Cache-Update:', error);
        }
    }

    /**
     * Bereinigt Session aus allen Caches
     * @param {number} sessionId - Session ID
     */
    clearSessionFromCache(sessionId) {
        try {
            this.activeStepsCache.delete(sessionId);
            this.scanStateCache.delete(sessionId);
        } catch (error) {
            console.warn('Fehler beim Cache-Bereinigen:', error);
        }
    }

    /**
     * Entfernt einen Schritt aus allen Caches
     * @param {number} stepId - QC-Schritt ID
     */
    removeStepFromCache(stepId) {
        try {
            for (const [sessionId, stepsSet] of this.activeStepsCache.entries()) {
                stepsSet.delete(stepId);
                if (stepsSet.size === 0) {
                    this.activeStepsCache.delete(sessionId);
                }
            }
        } catch (error) {
            console.warn('Fehler beim Entfernen des Schritts aus Cache:', error);
        }
    }

    /**
     * Holt Anzahl aktiver QC-Schritte für eine Session (Cache-optimiert)
     * @param {number} sessionId - Session ID
     * @returns {Promise<number>} - Anzahl aktiver Schritte
     */
    async getActiveStepsCount(sessionId) {
        try {
            // Versuche zuerst Cache
            if (this.activeStepsCache.has(sessionId)) {
                return this.activeStepsCache.get(sessionId).size;
            }

            // Fallback auf Datenbank
            const activeSteps = await this.getActiveQCStepsForSession(sessionId);
            const count = activeSteps.length;

            // Cache aktualisieren
            const stepsSet = new Set(activeSteps.map(step => step.ID));
            this.activeStepsCache.set(sessionId, stepsSet);

            return count;

        } catch (error) {
            console.error('Fehler beim Abrufen der aktiven Schritte-Anzahl:', error);
            return 0;
        }
    }

    // ===== HILFSFUNKTIONEN =====

    /**
     * Berechnet Dauer eines QC-Schritts in Minuten
     * @param {Date|string} startTime - Start-Zeit
     * @param {Date|string} endTime - End-Zeit (optional, sonst aktuelle Zeit)
     * @returns {number} - Dauer in Minuten
     */
    calculateStepDurationMinutes(startTime, endTime = null) {
        try {
            const start = new Date(startTime);
            const end = endTime ? new Date(endTime) : new Date();
            return Math.floor((end.getTime() - start.getTime()) / (1000 * 60));
        } catch (error) {
            return 0;
        }
    }

    /**
     * Berechnet Dauer eines QC-Schritts in Sekunden
     * @param {Date|string} startTime - Start-Zeit
     * @param {Date|string} endTime - End-Zeit (optional, sonst aktuelle Zeit)
     * @returns {number} - Dauer in Sekunden
     */
    calculateStepDurationSeconds(startTime, endTime = null) {
        try {
            const start = new Date(startTime);
            const end = endTime ? new Date(endTime) : new Date();
            return Math.floor((end.getTime() - start.getTime()) / 1000);
        } catch (error) {
            return 0;
        }
    }

    /**
     * Formatiert Dauer für Anzeige
     * @param {number} seconds - Dauer in Sekunden
     * @returns {string} - Formatierte Dauer (HH:MM:SS)
     */
    formatDuration(seconds) {
        if (typeof seconds !== 'number' || seconds < 0) return '00:00:00';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        return [hours, minutes, secs]
            .map(v => v.toString().padStart(2, '0'))
            .join(':');
    }

    /**
     * Prüft ob eine Stored Procedure verfügbar ist
     * @param {string} procedureName - Name der Stored Procedure
     * @returns {Promise<boolean>} - True wenn verfügbar
     */
    async hasStoredProcedure(procedureName) {
        try {
            const result = await this.dbClient.query(`
                SELECT COUNT(*) as ProcedureCount
                FROM INFORMATION_SCHEMA.ROUTINES
                WHERE ROUTINE_TYPE = 'PROCEDURE' AND ROUTINE_NAME = ?
            `, [procedureName]);

            return result.recordset[0]?.ProcedureCount > 0;
        } catch (error) {
            return false;
        }
    }

    /**
     * Erstellt Audit-Log-Eintrag (falls aktiviert)
     * @param {number} qcStepId - QC-Schritt ID
     * @param {string} actionType - Art der Aktion
     * @param {Object} data - Zusätzliche Daten
     * @returns {Promise<void>}
     */
    async logAuditEvent(qcStepId, actionType, data = {}) {
        if (!this.config.enableAuditLog) return;

        try {
            await this.dbClient.query(`
                INSERT INTO QualityControlAudit (QCStepID, ActionType, NewValues)
                VALUES (?, ?, ?)
            `, [qcStepId, actionType, JSON.stringify(data)]);
        } catch (error) {
            console.warn('Audit-Log-Eintrag fehlgeschlagen:', error);
        }
    }

    // ===== ERWEITERTE FUNKTIONEN =====

    /**
     * Holt QC-Übersicht für Session
     * @param {number} sessionId - Session ID
     * @returns {Promise<Object>} - QC-Übersicht
     */
    async getQCOverviewForSession(sessionId) {
        try {
            const [activeSteps, completedToday, sessionStats] = await Promise.all([
                this.getActiveQCStepsForSession(sessionId),
                this.getCompletedQCStepsToday(sessionId),
                this.getQCStatsForSession(sessionId)
            ]);

            const scanState = this.scanStateCache.get(sessionId) || {
                expectedScan: 'entrance',
                currentQRCode: null,
                lastScanTime: null
            };

            return {
                sessionId: sessionId,
                scanState: scanState,
                activeSteps: activeSteps,
                activeStepsCount: activeSteps.length,
                completedToday: completedToday,
                completedTodayCount: completedToday.length,
                sessionStats: sessionStats,
                limits: {
                    maxParallelSteps: this.config.maxParallelStepsPerSession,
                    stepTimeoutMinutes: this.config.stepTimeoutMinutes
                },
                generatedAt: new Date().toISOString()
            };

        } catch (error) {
            console.error('Fehler beim Erstellen der QC-Übersicht:', error);
            return {
                sessionId: sessionId,
                error: error.message,
                generatedAt: new Date().toISOString()
            };
        }
    }

    /**
     * Holt QC-Performance-Metriken für Session
     * @param {number} sessionId - Session ID
     * @param {number} days - Anzahl Tage rückblickend
     * @returns {Promise<Object>} - Performance-Metriken
     */
    async getQCPerformanceMetrics(sessionId, days = 7) {
        try {
            const result = await this.dbClient.query(`
                SELECT 
                    COUNT(*) as TotalSteps,
                    SUM(CASE WHEN Completed = 1 THEN 1 ELSE 0 END) as CompletedSteps,
                    SUM(CASE WHEN QCStatus = 'aborted' THEN 1 ELSE 0 END) as AbortedSteps,
                    AVG(CASE WHEN Completed = 1 THEN ActualDurationSeconds ELSE NULL END) as AvgDurationSeconds,
                    MIN(CASE WHEN Completed = 1 THEN ActualDurationSeconds ELSE NULL END) as MinDurationSeconds,
                    MAX(CASE WHEN Completed = 1 THEN ActualDurationSeconds ELSE NULL END) as MaxDurationSeconds,
                    SUM(CASE WHEN DefectsFound = 1 THEN 1 ELSE 0 END) as StepsWithDefects,
                    SUM(CASE WHEN ReworkRequired = 1 THEN 1 ELSE 0 END) as StepsRequiringRework,
                    AVG(CAST(QualityRating AS FLOAT)) as AvgQualityRating
                FROM QualityControlSteps
                WHERE SessionID = ? 
                  AND StartTime >= DATEADD(DAY, -?, CAST(GETDATE() AS DATE))
            `, [sessionId, days]);

            const metrics = result.recordset[0] || {};

            // Berechnete Metriken hinzufügen
            const completionRate = metrics.TotalSteps > 0 ?
                Math.round((metrics.CompletedSteps / metrics.TotalSteps) * 100) : 0;

            const defectRate = metrics.CompletedSteps > 0 ?
                Math.round((metrics.StepsWithDefects / metrics.CompletedSteps) * 100) : 0;

            return {
                ...metrics,
                completionRate: completionRate,
                defectRate: defectRate,
                avgDurationFormatted: this.formatDuration(metrics.AvgDurationSeconds || 0),
                daysAnalyzed: days,
                sessionId: sessionId,
                generatedAt: new Date().toISOString()
            };

        } catch (error) {
            console.error('Fehler beim Abrufen der QC-Performance-Metriken:', error);
            return {
                error: error.message,
                sessionId: sessionId,
                daysAnalyzed: days,
                generatedAt: new Date().toISOString()
            };
        }
    }

    /**
     * Bereinigt abgelaufene Cache-Einträge
     * @param {number} maxAgeMinutes - Maximales Alter in Minuten (default: 60)
     */
    cleanupCache(maxAgeMinutes = 60) {
        try {
            const now = new Date();
            const maxAge = maxAgeMinutes * 60 * 1000; // in Millisekunden

            // Scan-State-Cache bereinigen
            for (const [sessionId, scanState] of this.scanStateCache.entries()) {
                if (scanState.lastUpdated && (now - scanState.lastUpdated) > maxAge) {
                    this.scanStateCache.delete(sessionId);
                }
            }

            console.log(`Cache bereinigt: ${this.activeStepsCache.size} aktive Sessions, ${this.scanStateCache.size} Scan-States`);

        } catch (error) {
            console.warn('Fehler beim Cache-Bereinigen:', error);
        }
    }

    /**
     * Gibt aktuellen Status der QualityControlLogic zurück
     * @returns {Object} - Status-Informationen
     */
    getStatus() {
        return {
            config: this.config,
            cacheStats: {
                activeSessions: this.activeStepsCache.size,
                scanStates: this.scanStateCache.size,
                totalActiveSteps: Array.from(this.activeStepsCache.values())
                    .reduce((total, stepsSet) => total + stepsSet.size, 0)
            },
            initialized: !!(this.dbClient && this.qcQueries),
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = QualityControlLogic;