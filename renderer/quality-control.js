/**
 * Qualitätskontrolle Frontend Modul
 * Verwaltet die QC-spezifische Logik für Ein-/Ausgang-Scans und QC-Schritte
 */

class QualityControlManager {
    constructor(mainApp) {
        this.mainApp = mainApp;

        // QC-Schritt Tracking pro Session
        this.activeQCSteps = new Map(); // sessionId -> Set von QC-Schritten
        this.completedQCSteps = [];
        this.qcStepCounters = new Map(); // sessionId -> { active: count, completed: count }

        // QC-Scan Status Tracking
        this.scanStates = new Map(); // sessionId -> { expectedScan: 'eingang'|'ausgang', currentQRCode: string|null }

        // QC-spezifische Einstellungen
        this.qcSettings = {
            autoCompleteAfterExit: true,
            showCompletedToday: true,
            maxActiveStepsPerUser: 10,
            stepTimeoutMinutes: 120 // 2 Stunden
        };

        this.init();
    }

    init() {
        console.log('🔍 QualityControl Manager wird initialisiert...');
        this.setupQCEventListeners();
        this.startPeriodicQCUpdates();
    }

    // ===== EVENT LISTENERS =====
    setupQCEventListeners() {
        // QC-spezifische Buttons
        document.getElementById('refreshQCBtn').addEventListener('click', () => {
            this.refreshQCSteps();
        });

        // QC Step Modal
        document.getElementById('qcStepModalClose').addEventListener('click', () => {
            this.mainApp.hideModal('qcStepModal');
        });
        document.getElementById('qcStepModalClose2').addEventListener('click', () => {
            this.mainApp.hideModal('qcStepModal');
        });

        // QC Step Click Events (Event Delegation)
        document.getElementById('activeQCStepsList').addEventListener('click', (e) => {
            const qcStepCard = e.target.closest('.qc-step-card');
            if (qcStepCard) {
                const stepId = qcStepCard.dataset.stepId;
                this.showQCStepDetails(stepId);
            }
        });

        document.getElementById('completedQCStepsTableBody').addEventListener('click', (e) => {
            const row = e.target.closest('tr');
            if (row) {
                const stepId = row.dataset.stepId;
                this.showQCStepDetails(stepId);
            }
        });
    }

    // ===== QC-SCHRITT MANAGEMENT =====

    /**
     * Initialisiert QC-Tracking für eine neue Session
     */
    initializeSessionQC(sessionId) {
        this.activeQCSteps.set(sessionId, new Set());
        this.qcStepCounters.set(sessionId, { active: 0, completed: 0 });
        this.scanStates.set(sessionId, {
            expectedScan: 'eingang',
            currentQRCode: null,
            lastScanTime: null
        });

        console.log(`QC-Tracking für Session ${sessionId} initialisiert`);
    }

    /**
     * Bereinigt QC-Tracking für beendete Session
     */
    cleanupSessionQC(sessionId) {
        this.activeQCSteps.delete(sessionId);
        this.qcStepCounters.delete(sessionId);
        this.scanStates.delete(sessionId);

        console.log(`QC-Tracking für Session ${sessionId} bereinigt`);
    }

    /**
     * Verarbeitet QR-Scan für Qualitätskontrolle
     */
    async processQCScan(sessionId, qrData, scanResult) {
        try {
            const scanState = this.scanStates.get(sessionId);
            if (!scanState) {
                console.error(`Keine Scan-State für Session ${sessionId} gefunden`);
                return;
            }

            const { success, status, data } = scanResult;

            if (!success) {
                // Fehlgeschlagene Scans ignorieren für QC-Logik
                return;
            }

            // QC-Schritt verarbeiten basierend auf erwartetem Scan-Status
            if (scanState.expectedScan === 'eingang') {
                await this.handleEingangScan(sessionId, qrData, data);
            } else if (scanState.expectedScan === 'ausgang') {
                await this.handleAusgangScan(sessionId, qrData, data);
            }

            // UI Updates
            this.updateQCDisplay();
            this.updateScanStatusIndicator(sessionId);

        } catch (error) {
            console.error('Fehler bei QC-Scan-Verarbeitung:', error);
        }
    }

    /**
     * Verarbeitet Eingang-Scan (erster Scan eines QR-Codes)
     */
    async handleEingangScan(sessionId, qrData, scanData) {
        try {
            console.log(`📥 Eingang-Scan für Session ${sessionId}: ${qrData}`);

            // Neuen QC-Schritt im Backend erstellen
            const qcStep = await window.electronAPI.qualityControl.startStep(sessionId, qrData, scanData.ID);

            if (qcStep) {
                // Lokale QC-Schritt-Tracking aktualisieren
                const activeSteps = this.activeQCSteps.get(sessionId) || new Set();
                activeSteps.add(qcStep.ID);
                this.activeQCSteps.set(sessionId, activeSteps);

                // Scan-State aktualisieren
                const scanState = this.scanStates.get(sessionId);
                scanState.expectedScan = 'ausgang';
                scanState.currentQRCode = qrData;
                scanState.lastScanTime = new Date();

                // Counters aktualisieren
                const counters = this.qcStepCounters.get(sessionId);
                counters.active++;
                this.qcStepCounters.set(sessionId, counters);

                // Benachrichtigung
                this.mainApp.showNotification('success', 'Qualitätsprüfung gestartet',
                    `Eingang erfasst für: ${this.formatQRCode(qrData)}`);

                console.log(`✅ QC-Schritt ${qcStep.ID} gestartet`);
            }

        } catch (error) {
            console.error('Fehler beim Eingang-Scan:', error);
            this.mainApp.showNotification('error', 'Eingang-Scan Fehler', error.message);
        }
    }

    /**
     * Verarbeitet Ausgang-Scan (zweiter Scan desselben QR-Codes)
     */
    async handleAusgangScan(sessionId, qrData, scanData) {
        try {
            console.log(`📤 Ausgang-Scan für Session ${sessionId}: ${qrData}`);

            const scanState = this.scanStates.get(sessionId);

            // Prüfen ob es der gleiche QR-Code ist
            if (scanState.currentQRCode !== qrData) {
                // Anderer QR-Code während laufender Prüfung
                this.mainApp.showNotification('warning', 'Anderer QR-Code',
                    `Erwarteter Code: ${this.formatQRCode(scanState.currentQRCode)}\nGescannt: ${this.formatQRCode(qrData)}`);
                return;
            }

            // QC-Schritt im Backend abschließen
            const completedStep = await window.electronAPI.qualityControl.completeStep(sessionId, qrData, scanData.ID);

            if (completedStep) {
                // Lokale QC-Schritt-Tracking aktualisieren
                const activeSteps = this.activeQCSteps.get(sessionId);
                activeSteps.delete(completedStep.ID);

                // Zu abgeschlossenen Schritten hinzufügen
                this.completedQCSteps.unshift({
                    ...completedStep,
                    sessionId: sessionId,
                    completedAt: new Date()
                });

                // Scan-State zurücksetzen für nächsten QC-Schritt
                scanState.expectedScan = 'eingang';
                scanState.currentQRCode = null;
                scanState.lastScanTime = new Date();

                // Counters aktualisieren
                const counters = this.qcStepCounters.get(sessionId);
                counters.active--;
                counters.completed++;
                this.qcStepCounters.set(sessionId, counters);

                // Benachrichtigung
                const duration = this.calculateQCStepDuration(completedStep);
                this.mainApp.showNotification('success', 'Qualitätsprüfung abgeschlossen',
                    `Ausgang erfasst für: ${this.formatQRCode(qrData)} (${duration})`);

                console.log(`✅ QC-Schritt ${completedStep.ID} abgeschlossen`);
            }

        } catch (error) {
            console.error('Fehler beim Ausgang-Scan:', error);
            this.mainApp.showNotification('error', 'Ausgang-Scan Fehler', error.message);
        }
    }

    // ===== UI UPDATES =====

    /**
     * Aktualisiert den Scan-Status-Indikator für die ausgewählte Session
     */
    updateScanStatusIndicator(sessionId = null) {
        const selectedSessionId = sessionId || this.mainApp.selectedSession?.sessionId;
        if (!selectedSessionId) return;

        const scanState = this.scanStates.get(selectedSessionId);
        if (!scanState) return;

        const indicator = document.getElementById('scanStatusIndicator');
        const statusIcon = indicator.querySelector('.status-icon');
        const statusText = indicator.querySelector('.status-text');
        const expectedScanType = document.getElementById('expectedScanType');

        if (scanState.expectedScan === 'eingang') {
            statusIcon.textContent = '📥';
            statusText.textContent = 'Bereit für Eingang-Scan';
            expectedScanType.textContent = 'Eingang';
            indicator.className = 'scan-status-indicator ready-entrance';
        } else {
            statusIcon.textContent = '📤';
            statusText.textContent = `Erwarte Ausgang-Scan: ${this.formatQRCode(scanState.currentQRCode)}`;
            expectedScanType.textContent = 'Ausgang';
            indicator.className = 'scan-status-indicator waiting-exit';
        }
    }

    /**
     * Aktualisiert die QC-Display-Elemente
     */
    updateQCDisplay() {
        this.updateQCStats();
        this.updateActiveQCSteps();
        this.updateCompletedQCSteps();
    }

    /**
     * Aktualisiert QC-Statistiken im Header
     */
    updateQCStats() {
        const selectedSession = this.mainApp.selectedSession;
        if (!selectedSession) return;

        const counters = this.qcStepCounters.get(selectedSession.sessionId) || { active: 0, completed: 0 };

        document.getElementById('activeQCCount').textContent = counters.active;
        document.getElementById('completedQCCount').textContent = counters.completed;
        document.getElementById('selectedActiveQCSteps').textContent = counters.active;
    }

    /**
     * Aktualisiert die Liste der aktiven QC-Schritte
     */
    updateActiveQCSteps() {
        const selectedSession = this.mainApp.selectedSession;
        if (!selectedSession) {
            document.getElementById('activeQCStepsList').innerHTML = `
                <div class="empty-qc-steps">
                    <div class="empty-icon">🔍</div>
                    <p>Wählen Sie einen Mitarbeiter aus</p>
                </div>
            `;
            return;
        }

        const activeSteps = this.activeQCSteps.get(selectedSession.sessionId) || new Set();

        if (activeSteps.size === 0) {
            document.getElementById('activeQCStepsList').innerHTML = `
                <div class="empty-qc-steps">
                    <div class="empty-icon">🔍</div>
                    <p>Keine laufenden Qualitätsprüfungen</p>
                </div>
            `;
            return;
        }

        // Aktive QC-Schritte vom Backend laden
        this.loadActiveQCStepsFromBackend(selectedSession.sessionId);
    }

    /**
     * Lädt aktive QC-Schritte vom Backend und zeigt sie an
     */
    async loadActiveQCStepsFromBackend(sessionId) {
        try {
            const activeSteps = await window.electronAPI.qualityControl.getActiveSteps(sessionId);

            const stepsHtml = activeSteps.map(step => {
                const duration = this.calculateQCStepDuration(step);
                const formattedQR = this.formatQRCode(step.QrCode);

                return `
                    <div class="qc-step-card" data-step-id="${step.ID}">
                        <div class="qc-step-header">
                            <div class="qc-step-icon">🔄</div>
                            <div class="qc-step-info">
                                <div class="qc-step-code">${formattedQR}</div>
                                <div class="qc-step-time">Gestartet: ${utils.formatTimestamp(step.StartTime, 'time')}</div>
                            </div>
                            <div class="qc-step-duration">${duration}</div>
                        </div>
                        <div class="qc-step-status">
                            <span class="status-indicator running">
                                <span class="status-dot"></span>
                                Läuft - Warte auf Ausgang-Scan
                            </span>
                        </div>
                    </div>
                `;
            }).join('');

            document.getElementById('activeQCStepsList').innerHTML = stepsHtml;

        } catch (error) {
            console.error('Fehler beim Laden aktiver QC-Schritte:', error);
        }
    }

    /**
     * Aktualisiert die Tabelle der abgeschlossenen QC-Schritte
     */
    async updateCompletedQCSteps() {
        try {
            const selectedSession = this.mainApp.selectedSession;
            if (!selectedSession) {
                this.showEmptyCompletedQCSteps();
                return;
            }

            const completedSteps = await window.electronAPI.qualityControl.getCompletedStepsToday(selectedSession.sessionId);

            if (completedSteps.length === 0) {
                this.showEmptyCompletedQCSteps();
                return;
            }

            const tableBody = document.getElementById('completedQCStepsTableBody');
            const emptyMessage = document.getElementById('emptyCompletedQCSteps');
            const table = document.querySelector('.qc-steps-table');

            table.style.display = 'table';
            emptyMessage.style.display = 'none';

            const rowsHtml = completedSteps.map(step => {
                const duration = this.calculateQCStepDuration(step);
                const formattedQR = this.formatQRCode(step.QrCode);
                const startTime = utils.formatTimestamp(step.StartTime, 'time');

                return `
                    <tr data-step-id="${step.ID}">
                        <td class="qc-time-col">${startTime}</td>
                        <td class="qc-duration-col">${duration}</td>
                        <td class="qc-user-col">${selectedSession.userName}</td>
                        <td class="qc-code-col">${formattedQR}</td>
                        <td class="qc-status-col">
                            <span class="status-badge completed">✅ Abgeschlossen</span>
                        </td>
                    </tr>
                `;
            }).join('');

            tableBody.innerHTML = rowsHtml;

        } catch (error) {
            console.error('Fehler beim Laden abgeschlossener QC-Schritte:', error);
            this.showEmptyCompletedQCSteps();
        }
    }

    showEmptyCompletedQCSteps() {
        const table = document.querySelector('.qc-steps-table');
        const emptyMessage = document.getElementById('emptyCompletedQCSteps');

        table.style.display = 'none';
        emptyMessage.style.display = 'block';
    }

    // ===== QC STEP DETAILS MODAL =====

    async showQCStepDetails(stepId) {
        try {
            const stepDetails = await window.electronAPI.qualityControl.getStepDetails(stepId);

            if (!stepDetails) {
                this.mainApp.showNotification('error', 'Fehler', 'QC-Schritt Details nicht gefunden');
                return;
            }

            const detailsHtml = this.renderQCStepDetails(stepDetails);
            document.getElementById('qcStepDetails').innerHTML = detailsHtml;

            this.mainApp.showModal('qcStepModal');

        } catch (error) {
            console.error('Fehler beim Laden der QC-Schritt Details:', error);
            this.mainApp.showNotification('error', 'Fehler', 'QC-Schritt Details konnten nicht geladen werden');
        }
    }

    renderQCStepDetails(stepDetails) {
        const duration = this.calculateQCStepDuration(stepDetails);
        const formattedQR = this.formatQRCode(stepDetails.QrCode);
        const isCompleted = stepDetails.Completed;

        return `
            <div class="qc-step-detail-grid">
                <div class="detail-section">
                    <h5>📋 Grundinformationen</h5>
                    <div class="detail-row">
                        <span class="detail-label">QR-Code:</span>
                        <span class="detail-value">${formattedQR}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Status:</span>
                        <span class="detail-value">
                            ${isCompleted ?
            '<span class="status-badge completed">✅ Abgeschlossen</span>' :
            '<span class="status-badge running">🔄 Läuft</span>'
        }
                        </span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Dauer:</span>
                        <span class="detail-value">${duration}</span>
                    </div>
                </div>

                <div class="detail-section">
                    <h5>⏰ Zeitstempel</h5>
                    <div class="detail-row">
                        <span class="detail-label">Eingang-Scan:</span>
                        <span class="detail-value">${utils.formatTimestamp(stepDetails.StartTime)}</span>
                    </div>
                    ${isCompleted ? `
                        <div class="detail-row">
                            <span class="detail-label">Ausgang-Scan:</span>
                            <span class="detail-value">${utils.formatTimestamp(stepDetails.EndTime)}</span>
                        </div>
                    ` : `
                        <div class="detail-row">
                            <span class="detail-label">Ausgang-Scan:</span>
                            <span class="detail-value pending">⏳ Ausstehend</span>
                        </div>
                    `}
                </div>

                <div class="detail-section">
                    <h5>🔍 Scan-Details</h5>
                    <div class="detail-row">
                        <span class="detail-label">Eingang-Scan ID:</span>
                        <span class="detail-value">${stepDetails.StartScanID}</span>
                    </div>
                    ${isCompleted ? `
                        <div class="detail-row">
                            <span class="detail-label">Ausgang-Scan ID:</span>
                            <span class="detail-value">${stepDetails.EndScanID}</span>
                        </div>
                    ` : `
                        <div class="detail-row">
                            <span class="detail-label">Ausgang-Scan ID:</span>
                            <span class="detail-value pending">⏳ Ausstehend</span>
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    // ===== UTILITY METHODEN =====

    /**
     * Berechnet die Dauer eines QC-Schritts
     */
    calculateQCStepDuration(step) {
        const startTime = new Date(step.StartTime);
        const endTime = step.EndTime ? new Date(step.EndTime) : new Date();

        const durationMs = endTime.getTime() - startTime.getTime();
        const durationSec = Math.floor(durationMs / 1000);

        return utils.formatDuration(durationSec);
    }

    /**
     * Formatiert QR-Code für Anzeige
     */
    formatQRCode(qrCode) {
        if (!qrCode) return '-';

        // Kürze lange QR-Codes für bessere Lesbarkeit
        if (qrCode.length > 20) {
            return qrCode.substring(0, 20) + '...';
        }
        return qrCode;
    }

    /**
     * Aktualisiert QC-Daten für ausgewählten Benutzer
     */
    async refreshQCSteps() {
        if (!this.mainApp.selectedSession) {
            this.mainApp.showNotification('warning', 'Kein Benutzer ausgewählt', 'Bitte wählen Sie zuerst einen Mitarbeiter aus');
            return;
        }

        try {
            await this.updateQCDisplay();
            this.mainApp.showNotification('info', 'Aktualisiert', 'QC-Daten wurden aktualisiert');
        } catch (error) {
            console.error('Fehler beim Aktualisieren der QC-Daten:', error);
            this.mainApp.showNotification('error', 'Fehler', 'QC-Daten konnten nicht aktualisiert werden');
        }
    }

    /**
     * Startet periodische Updates der QC-Daten
     */
    startPeriodicQCUpdates() {
        // Alle 30 Sekunden QC-Display aktualisieren
        setInterval(() => {
            if (this.mainApp.selectedSession) {
                this.updateQCDisplay();
                this.updateScanStatusIndicator();
            }
        }, 30000);

        // Alle 5 Sekunden aktive QC-Schritt Dauern aktualisieren
        setInterval(() => {
            this.updateActiveQCStepDurations();
        }, 5000);
    }

    /**
     * Aktualisiert die Dauern der aktiven QC-Schritte in Echtzeit
     */
    updateActiveQCStepDurations() {
        const qcStepCards = document.querySelectorAll('.qc-step-card');

        qcStepCards.forEach(card => {
            const durationElement = card.querySelector('.qc-step-duration');
            const timeElement = card.querySelector('.qc-step-time');

            if (durationElement && timeElement) {
                // Parse Start-Zeit aus dem Text
                const timeText = timeElement.textContent;
                const timeMatch = timeText.match(/(\d{2}:\d{2}:\d{2})/);

                if (timeMatch) {
                    const timeStr = timeMatch[1];
                    const today = new Date();
                    const [hours, minutes, seconds] = timeStr.split(':').map(Number);

                    const startTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes, seconds);
                    const now = new Date();
                    const durationMs = now.getTime() - startTime.getTime();
                    const durationSec = Math.floor(durationMs / 1000);

                    if (durationSec >= 0) {
                        durationElement.textContent = utils.formatDuration(durationSec);
                    }
                }
            }
        });
    }

    // ===== SESSION MANAGEMENT INTEGRATION =====

    /**
     * Wird aufgerufen wenn ein Benutzer ausgewählt wird
     */
    onUserSelected(sessionData) {
        if (!this.scanStates.has(sessionData.sessionId)) {
            this.initializeSessionQC(sessionData.sessionId);
        }

        this.updateScanStatusIndicator(sessionData.sessionId);
        this.updateQCDisplay();
    }

    /**
     * Wird aufgerufen wenn ein Benutzer abgemeldet wird
     */
    onUserLoggedOut(sessionData) {
        this.cleanupSessionQC(sessionData.sessionId);
    }

    /**
     * Wird aufgerufen wenn eine Session neu gestartet wird
     */
    onSessionRestarted(sessionData) {
        // QC-Tracking zurücksetzen aber nicht löschen
        const scanState = this.scanStates.get(sessionData.sessionId);
        if (scanState) {
            scanState.expectedScan = 'eingang';
            scanState.currentQRCode = null;
            scanState.lastScanTime = new Date();
        }

        // UI aktualisieren
        this.updateScanStatusIndicator(sessionData.sessionId);
        this.updateQCDisplay();
    }

    // ===== EXTERNE API =====

    /**
     * Externe API für die Hauptanwendung um QC-Scan zu verarbeiten
     */
    async processScan(sessionId, qrData, scanResult) {
        return await this.processQCScan(sessionId, qrData, scanResult);
    }

    /**
     * Gibt QC-Status für Session zurück
     */
    getQCStatus(sessionId) {
        const scanState = this.scanStates.get(sessionId);
        const counters = this.qcStepCounters.get(sessionId);
        const activeSteps = this.activeQCSteps.get(sessionId);

        return {
            expectedScan: scanState?.expectedScan || 'eingang',
            currentQRCode: scanState?.currentQRCode || null,
            activeStepCount: counters?.active || 0,
            completedStepCount: counters?.completed || 0,
            activeStepIds: activeSteps ? Array.from(activeSteps) : [],
            lastScanTime: scanState?.lastScanTime || null
        };
    }

    /**
     * Erzwingt Reset der QC-Tracking für Session (für Debugging)
     */
    resetSessionQC(sessionId) {
        console.log(`🔄 Erzwinge QC-Reset für Session ${sessionId}`);
        this.cleanupSessionQC(sessionId);
        this.initializeSessionQC(sessionId);
        this.updateQCDisplay();
        this.updateScanStatusIndicator(sessionId);
    }
}

// Globale QC-Manager Instanz wird von der Hauptanwendung erstellt
window.QualityControlManager = QualityControlManager;