const { contextBridge, ipcRenderer } = require('electron');

// Sichere API für Renderer Process - Qualitätskontrolle
contextBridge.exposeInMainWorld('electronAPI', {
    // ===== DATENBANK OPERATIONEN =====
    db: {
        query: (query, params) => ipcRenderer.invoke('db-query', query, params),
        getUserByEPC: (tagId) => ipcRenderer.invoke('db-get-user-by-epc', tagId),
        getUserById: (userId) => ipcRenderer.invoke('db-get-user-by-id', userId)
    },

    // ===== PARALLELES SESSION MANAGEMENT =====
    session: {
        // Alle aktiven Sessions abrufen
        getAllActive: () => ipcRenderer.invoke('session-get-all-active'),

        // Neue Session erstellen (ohne bestehende zu beenden)
        create: (userId) => ipcRenderer.invoke('session-create', userId),

        // Session neu starten (Timer und QC-Status zurücksetzen)
        restart: (sessionId, userId) => ipcRenderer.invoke('session-restart', sessionId, userId),

        // Spezifische Session beenden
        end: (sessionId, userId) => ipcRenderer.invoke('session-end', sessionId, userId)
    },

    // ===== QUALITÄTSKONTROLLE OPERATIONEN =====
    qualityControl: {
        // QC-Schritt starten (Eingang-Scan)
        startStep: (sessionId, qrCode, scanId) => ipcRenderer.invoke('quality-control-start-step', sessionId, qrCode, scanId),

        // QC-Schritt abschließen (Ausgang-Scan)
        completeStep: (sessionId, qrCode, scanId) => ipcRenderer.invoke('quality-control-complete-step', sessionId, qrCode, scanId),

        // Aktive QC-Schritte für Session abrufen
        getActiveSteps: (sessionId) => ipcRenderer.invoke('quality-control-get-active-steps', sessionId),

        // Heute abgeschlossene QC-Schritte für Session abrufen
        getCompletedStepsToday: (sessionId) => ipcRenderer.invoke('quality-control-get-completed-today', sessionId),

        // QC-Schritt Details abrufen
        getStepDetails: (stepId) => ipcRenderer.invoke('quality-control-get-step-details', stepId)
    },

    // ===== QR-CODE OPERATIONEN MIT DEKODIERUNG =====
    qr: {
        saveScan: (sessionId, payload) => ipcRenderer.invoke('qr-scan-save', sessionId, payload),
        getDecodedScans: (sessionId, limit) => ipcRenderer.invoke('qr-get-decoded-scans', sessionId, limit),
        searchDecoded: (searchTerm, sessionId) => ipcRenderer.invoke('qr-search-decoded', searchTerm, sessionId),
        getDecodingStats: (sessionId) => ipcRenderer.invoke('qr-get-decoding-stats', sessionId)
    },

    // ===== RFID OPERATIONEN =====
    rfid: {
        getStatus: () => ipcRenderer.invoke('rfid-get-status'),
        simulateTag: (tagId) => ipcRenderer.invoke('rfid-simulate-tag', tagId)
    },

    // ===== SYSTEM STATUS =====
    system: {
        getStatus: () => ipcRenderer.invoke('get-system-status'),
        getInfo: () => ipcRenderer.invoke('get-system-info')
    },

    // ===== APP STEUERUNG =====
    app: {
        minimize: () => ipcRenderer.invoke('app-minimize'),
        close: () => ipcRenderer.invoke('app-close'),
        restart: () => ipcRenderer.invoke('app-restart'),
        getSystemInfo: () => ipcRenderer.invoke('get-system-info')
    },

    // ===== EVENT LISTENERS - QUALITÄTSKONTROLLE =====
    on: (channel, callback) => {
        const validChannels = [
            'system-ready',
            'system-error',
            'user-login',           // Neuer Benutzer loggt sich ein
            'user-logout',          // Benutzer loggt sich aus
            'session-restarted',    // Session wurde neu gestartet (RFID-Rescan)
            'session-timer-update', // Timer-Updates für Sessions
            'rfid-scan-error',
            'qr-scan-detected',
            'decoding-stats-updated',
            'qc-step-started',      // QC-Schritt wurde gestartet
            'qc-step-completed',    // QC-Schritt wurde abgeschlossen
            'qc-step-aborted'       // QC-Schritt wurde abgebrochen
        ];

        if (validChannels.includes(channel)) {
            ipcRenderer.removeAllListeners(channel);
            ipcRenderer.on(channel, (event, data) => callback(data));
        }
    },

    off: (channel) => {
        ipcRenderer.removeAllListeners(channel);
    },

    once: (channel, callback) => {
        const validChannels = [
            'system-ready',
            'system-error',
            'user-login',
            'user-logout',
            'session-restarted',
            'session-timer-update',
            'rfid-scan-error',
            'qr-scan-detected',
            'decoding-stats-updated',
            'qc-step-started',
            'qc-step-completed',
            'qc-step-aborted'
        ];

        if (validChannels.includes(channel)) {
            ipcRenderer.once(channel, (event, data) => callback(data));
        }
    }
});

// ===== KAMERA API =====
contextBridge.exposeInMainWorld('cameraAPI', {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    getDevices: () => navigator.mediaDevices.enumerateDevices(),

    checkPermissions: async () => {
        try {
            const result = await navigator.permissions.query({ name: 'camera' });
            return result.state;
        } catch (error) {
            return 'unknown';
        }
    },

    getSupportedConstraints: () => navigator.mediaDevices.getSupportedConstraints(),

    stopStream: (stream) => {
        if (stream && stream.getTracks) {
            stream.getTracks().forEach(track => track.stop());
        }
    }
});

// ===== ERWEITERTE UTILITY FUNKTIONEN FÜR QUALITÄTSKONTROLLE =====
contextBridge.exposeInMainWorld('utils', {
    // ===== ZEIT & DATUM FORMATIERUNG =====
    formatDuration: (seconds) => {
        if (typeof seconds !== 'number' || seconds < 0) return '00:00:00';

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        return [hours, minutes, secs]
            .map(v => v.toString().padStart(2, '0'))
            .join(':');
    },

    formatTimestamp: (timestamp, format = 'datetime') => {
        try {
            const date = new Date(timestamp);

            // Prüfe auf gültiges Datum
            if (isNaN(date.getTime())) {
                return 'Ungültiges Datum';
            }

            const options = {
                timeZone: 'Europe/Berlin', // Deutsche Zeitzone
            };

            switch (format) {
                case 'time':
                    return date.toLocaleTimeString('de-DE', {
                        ...options,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    });

                case 'date':
                    return date.toLocaleDateString('de-DE', {
                        ...options,
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    });

                case 'datetime':
                    return date.toLocaleString('de-DE', {
                        ...options,
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                    });

                case 'short':
                    return date.toLocaleString('de-DE', {
                        ...options,
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                    });

                case 'relative':
                    return this.getRelativeTime(date);

                case 'iso':
                    return date.toISOString();

                default:
                    return date.toLocaleString('de-DE', options);
            }
        } catch (error) {
            console.error('Fehler bei Zeitformatierung:', error);
            return 'Formatfehler';
        }
    },

    getRelativeTime: (date) => {
        try {
            const now = new Date();
            const diffMs = now - new Date(date);
            const diffSecs = Math.floor(diffMs / 1000);
            const diffMins = Math.floor(diffSecs / 60);
            const diffHours = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHours / 24);

            if (diffSecs < 5) return 'gerade eben';
            if (diffSecs < 60) return `vor ${diffSecs} Sekunde${diffSecs !== 1 ? 'n' : ''}`;
            if (diffMins < 60) return `vor ${diffMins} Minute${diffMins !== 1 ? 'n' : ''}`;
            if (diffHours < 24) return `vor ${diffHours} Stunde${diffHours !== 1 ? 'n' : ''}`;
            if (diffDays < 7) return `vor ${diffDays} Tag${diffDays !== 1 ? 'en' : ''}`;

            return new Date(date).toLocaleDateString('de-DE');
        } catch (error) {
            return 'Unbekannt';
        }
    },

    getCurrentTimestamp: () => new Date().toISOString(),

    // ===== SESSION DURATION BERECHNUNG =====
    calculateSessionDuration: (startTime) => {
        try {
            const start = new Date(startTime);
            const now = new Date();

            if (isNaN(start.getTime())) {
                return 0;
            }

            const diffMs = now.getTime() - start.getTime();
            return Math.max(0, Math.floor(diffMs / 1000));
        } catch (error) {
            console.error('Fehler bei Session-Duration-Berechnung:', error);
            return 0;
        }
    },

    // ===== QC-SPEZIFISCHE DURATION BERECHNUNG =====
    calculateQCStepDuration: (startTime, endTime = null) => {
        try {
            const start = new Date(startTime);
            const end = endTime ? new Date(endTime) : new Date();

            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                return 0;
            }

            const diffMs = end.getTime() - start.getTime();
            return Math.max(0, Math.floor(diffMs / 1000));
        } catch (error) {
            console.error('Fehler bei QC-Step-Duration-Berechnung:', error);
            return 0;
        }
    },

    // ===== RFID TAG VALIDIERUNG =====
    validateTagId: (tagId) => {
        if (!tagId || typeof tagId !== 'string') return false;

        const cleaned = tagId.trim().toUpperCase();

        // Prüfe Länge (8-12 Hex-Zeichen sind typisch)
        if (cleaned.length < 8 || cleaned.length > 12) return false;

        // Prüfe Hex-Format
        if (!/^[0-9A-F]+$/.test(cleaned)) return false;

        // Prüfe ob konvertierbar und nicht Null
        try {
            const decimal = parseInt(cleaned, 16);
            return decimal > 0;
        } catch (error) {
            return false;
        }
    },

    // ===== QR-CODE DEKODIERUNG UND VERARBEITUNG =====

    /**
     * Dekodiert QR-Code Daten basierend auf der Backend-Logik
     * @param {string} data - Rohe QR-Code Daten
     * @returns {Object} - Dekodierte Informationen
     */
    decodeQRData: (data) => {
        const result = {
            auftrags_nr: "",
            paket_nr: "",
            kunden_name: "",
            original_data: data,
            format_type: "unknown"
        };

        if (!data || typeof data !== 'string') {
            return result;
        }

        try {
            // Spezielles durch ^ getrenntes Format (hat höchste Priorität)
            if (data.includes('^')) {
                const parts = data.split('^');

                // Wir benötigen mindestens 4 Teile für Auftragsnummer und Paketnummer
                if (parts.length >= 4) {
                    result.format_type = "caret_separated";

                    // Auftragsnummer ist im zweiten Feld (Index 1)
                    result.auftrags_nr = parts[1] || "";

                    // Paketnummer ist im vierten Feld (Index 3)
                    result.paket_nr = parts[3] || "";

                    // Falls verfügbar, Kundennummer oder ID im dritten Feld (Index 2)
                    if (parts.length > 2 && parts[2]) {
                        result.kunden_name = `Kunden-ID: ${parts[2]}`;
                    }

                    return result;
                }
            }

            result.format_type = "pattern_matching";

            // Versuch, die Auftragsnummer zu extrahieren
            // Basierend auf den Beispielbildern, Muster "NL-XXXXXXX" oder ähnlich
            const auftragsNrMatch = data.match(/[A-Z]{2}-\d+/);
            if (auftragsNrMatch) {
                result.auftrags_nr = auftragsNrMatch[0];
            }

            // Versuch, die Paketnummer zu extrahieren
            // Langer numerischer Code, wie in den Beispielbildern
            const paketNrMatch = data.match(/\d{10,}/);
            if (paketNrMatch) {
                result.paket_nr = paketNrMatch[0];
            }

            // Versuch, den Kundennamen zu extrahieren
            if (data.includes("KUNDENNAME:")) {
                const parts = data.split("KUNDENNAME:");
                if (parts.length > 1) {
                    let kundenName = parts[1].trim();
                    // Bis zum nächsten Schlüsselwort oder Ende nehmen
                    const endMarkers = ["PAKET-NR", "AUFTRAG", "\n"];
                    for (const marker of endMarkers) {
                        if (kundenName.includes(marker)) {
                            kundenName = kundenName.split(marker)[0].trim();
                            break;
                        }
                    }
                    result.kunden_name = kundenName;
                }
            }

            // Zusätzliche Suche für andere Formate
            // Nach "Referenz: XXX" oder ähnlichen Patterns suchen
            if (!result.auftrags_nr) {
                const referenzMatch = data.match(/Referenz:\s+([A-Z0-9-]+)/);
                if (referenzMatch) {
                    result.auftrags_nr = referenzMatch[1];
                }
            }

            // Nach "Tracking: XXX" oder ähnlichen Patterns suchen
            if (!result.paket_nr) {
                const trackingMatch = data.match(/Tracking:\s+(\d+)/);
                if (trackingMatch) {
                    result.paket_nr = trackingMatch[1];
                }
            }

            return result;

        } catch (error) {
            console.error('Fehler beim Dekodieren der QR-Code Daten:', error);
            result.format_type = "error";
            return result;
        }
    },

    /**
     * Erstellt eine benutzerfreundliche Anzeige für dekodierte QR-Codes
     * @param {Object} decoded - Dekodierte QR-Code Daten
     * @returns {Object} - Formatierte Anzeige-Informationen
     */
    formatDecodedData: (decoded) => {
        if (!decoded || typeof decoded !== 'object') {
            return {
                hasData: false,
                icon: '📄',
                title: 'Unstrukturierte Daten',
                fields: [],
                summary: 'Keine dekodierten Daten verfügbar'
            };
        }

        const { auftrags_nr, paket_nr, kunden_name, format_type } = decoded;
        const fields = [];

        // Auftragsnummer
        if (auftrags_nr && auftrags_nr.trim()) {
            fields.push({
                label: 'Auftrag',
                value: auftrags_nr.trim(),
                type: 'auftrag',
                icon: '📋'
            });
        }

        // Paketnummer
        if (paket_nr && paket_nr.trim()) {
            fields.push({
                label: 'Paket',
                value: paket_nr.trim(),
                type: 'paket',
                icon: '📦'
            });
        }

        // Kundenname/ID
        if (kunden_name && kunden_name.trim()) {
            fields.push({
                label: 'Kunde',
                value: kunden_name.trim(),
                type: 'kunde',
                icon: '👤'
            });
        }

        // Icon und Titel basierend auf verfügbaren Daten
        let icon = '📄';
        let title = 'QC-Prüfobjekt';
        let quality = 'minimal';

        if (auftrags_nr && paket_nr) {
            icon = '🔍';
            title = 'Vollständige Prüfdaten';
            quality = 'complete';
        } else if (auftrags_nr || paket_nr) {
            icon = '📋';
            title = 'Teilweise Prüfdaten';
            quality = 'partial';
        } else if (kunden_name) {
            icon = '👤';
            title = 'Kundeninformationen';
            quality = 'customer';
        } else {
            icon = '📄';
            title = 'Unstrukturierte Daten';
            quality = 'minimal';
        }

        // Zusammenfassung erstellen
        const parts = [];
        if (auftrags_nr) parts.push(`Auftrag: ${auftrags_nr}`);
        if (paket_nr) parts.push(`Paket: ${paket_nr}`);
        if (kunden_name) parts.push(kunden_name);

        const summary = parts.length > 0 ? parts.join(' • ') : 'Keine strukturierten Daten erkannt';

        return {
            hasData: fields.length > 0,
            icon: icon,
            title: title,
            fields: fields,
            summary: summary,
            quality: quality,
            formatType: format_type || 'unknown'
        };
    },

    /**
     * Validiert dekodierte QR-Code Daten für QC
     * @param {Object} decoded - Dekodierte Daten
     * @returns {Object} - Validierungsergebnis
     */
    validateDecodedData: (decoded) => {
        const validation = {
            isValid: false,
            hasAuftrag: false,
            hasPaket: false,
            hasKunde: false,
            completeness: 0,
            issues: [],
            qcSuitability: 'poor' // poor, fair, good, excellent
        };

        if (!decoded || typeof decoded !== 'object') {
            validation.issues.push('Keine dekodierten Daten vorhanden');
            return validation;
        }

        const { auftrags_nr, paket_nr, kunden_name } = decoded;

        // Auftragsnummer prüfen
        if (auftrags_nr && auftrags_nr.trim()) {
            validation.hasAuftrag = true;
            // Validiere Format (z.B. NL-123456)
            if (!/^[A-Z]{2}-\d+$/.test(auftrags_nr.trim())) {
                validation.issues.push('Auftragsnummer hat ungewöhnliches Format');
            }
        }

        // Paketnummer prüfen
        if (paket_nr && paket_nr.trim()) {
            validation.hasPaket = true;
            // Validiere dass es numerisch ist und mindestens 10 Stellen hat
            if (!/^\d{10,}$/.test(paket_nr.trim())) {
                validation.issues.push('Paketnummer hat ungewöhnliches Format');
            }
        }

        // Kundenname prüfen
        if (kunden_name && kunden_name.trim()) {
            validation.hasKunde = true;
        }

        // Vollständigkeit berechnen
        let completenessScore = 0;
        if (validation.hasAuftrag) completenessScore += 40;
        if (validation.hasPaket) completenessScore += 40;
        if (validation.hasKunde) completenessScore += 20;

        validation.completeness = completenessScore;

        // QC-Eignung bewerten
        if (completenessScore >= 80) {
            validation.qcSuitability = 'excellent';
        } else if (completenessScore >= 60) {
            validation.qcSuitability = 'good';
        } else if (completenessScore >= 40) {
            validation.qcSuitability = 'fair';
        } else {
            validation.qcSuitability = 'poor';
        }

        // Für QC ist mindestens Auftrag oder Paket erforderlich
        validation.isValid = validation.hasAuftrag || validation.hasPaket;

        return validation;
    },

    /**
     * Überprüft QC-Schritt Status
     * @param {Object} qcStep - QC-Schritt Daten
     * @returns {Object} - Status-Informationen
     */
    getQCStepStatus: (qcStep) => {
        if (!qcStep) {
            return {
                status: 'unknown',
                stage: 'unknown',
                icon: '❓',
                description: 'Unbekannter Status'
            };
        }

        const { Completed, StartTime, EndTime } = qcStep;

        if (Completed && EndTime) {
            return {
                status: 'completed',
                stage: 'finished',
                icon: '✅',
                description: 'Abgeschlossen'
            };
        } else if (StartTime && !EndTime) {
            return {
                status: 'active',
                stage: 'in_progress',
                icon: '🔄',
                description: 'Läuft - Warte auf Ausgang'
            };
        } else {
            return {
                status: 'pending',
                stage: 'waiting',
                icon: '⏳',
                description: 'Wartend'
            };
        }
    },

    parseQRPayload: (payload) => {
        if (!payload || typeof payload !== 'string') {
            return { type: 'invalid', data: null, display: 'Ungültiger QR-Code' };
        }

        try {
            // JSON-Format versuchen
            const jsonData = JSON.parse(payload);
            return {
                type: 'json',
                data: jsonData,
                display: JSON.stringify(jsonData, null, 2),
                preview: this.createJSONPreview(jsonData)
            };
        } catch (e) {
            // Versuche QR-Code zu dekodieren
            const decoded = this.decodeQRData(payload);
            const formatted = this.formatDecodedData(decoded);

            if (formatted.hasData) {
                return {
                    type: 'decoded_qr',
                    data: decoded,
                    display: formatted.summary,
                    preview: formatted.title,
                    formatted: formatted,
                    qcSuitability: this.validateDecodedData(decoded).qcSuitability
                };
            }

            // Key-Value Format versuchen (Format: key1:value1^key2:value2)
            if (payload.includes('^') && payload.includes(':')) {
                const parts = payload.split('^');
                const data = {};
                let valid = false;

                parts.forEach(part => {
                    if (part.includes(':')) {
                        const [key, ...valueParts] = part.split(':');
                        const value = valueParts.join(':'); // Für Werte mit ':'
                        data[key.trim()] = value.trim();
                        valid = true;
                    }
                });

                if (valid) {
                    const display = Object.entries(data)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join('\n');
                    return {
                        type: 'keyvalue',
                        data,
                        display,
                        preview: this.createKeyValuePreview(data)
                    };
                }
            }

            // Barcode-Format erkennen (EAN, UPC, etc.)
            if (/^\d{8,14}$/.test(payload)) {
                return {
                    type: 'barcode',
                    data: payload,
                    display: payload,
                    preview: `Barcode: ${payload}`
                };
            }

            // URL-Format
            if (payload.startsWith('http://') || payload.startsWith('https://')) {
                return {
                    type: 'url',
                    data: payload,
                    display: payload,
                    preview: `URL: ${payload.length > 50 ? payload.substring(0, 50) + '...' : payload}`
                };
            }

            // Plain Text
            return {
                type: 'text',
                data: payload,
                display: payload,
                preview: payload.length > 100 ? payload.substring(0, 100) + '...' : payload
            };
        }
    },

    createJSONPreview: (jsonData) => {
        try {
            if (typeof jsonData === 'object') {
                const keys = Object.keys(jsonData);
                if (keys.length === 0) return 'Leeres JSON-Objekt';

                const preview = keys.slice(0, 3).map(key => {
                    const value = jsonData[key];
                    const shortValue = typeof value === 'string' && value.length > 20
                        ? value.substring(0, 20) + '...'
                        : value;
                    return `${key}: ${shortValue}`;
                }).join(', ');

                return keys.length > 3 ? `${preview}...` : preview;
            }
            return String(jsonData);
        } catch (error) {
            return 'JSON-Vorschau nicht verfügbar';
        }
    },

    createKeyValuePreview: (data) => {
        try {
            const entries = Object.entries(data);
            if (entries.length === 0) return 'Keine Daten';

            const preview = entries.slice(0, 2).map(([key, value]) => {
                const shortValue = value.length > 15 ? value.substring(0, 15) + '...' : value;
                return `${key}: ${shortValue}`;
            }).join(', ');

            return entries.length > 2 ? `${preview}...` : preview;
        } catch (error) {
            return 'Vorschau nicht verfügbar';
        }
    },

    // ===== QC-SCAN RESULT HANDLING =====
    formatQCScanResult: (result) => {
        if (!result || typeof result !== 'object') {
            return {
                success: false,
                message: 'Ungültiges QC-Scan-Ergebnis',
                status: 'error',
                qcStage: 'unknown'
            };
        }

        const { success, status, message, data, duplicateInfo } = result;

        let formattedMessage = message || 'Unbekannter Status';
        let displayType = status || 'unknown';
        let decodedSummary = null;
        let qcStage = 'unknown'; // entrance, exit, unknown

        // Dekodierte Daten extrahieren falls verfügbar
        if (data && data.DecodedData) {
            const formatted = this.formatDecodedData(data.DecodedData);
            if (formatted.hasData) {
                decodedSummary = formatted.summary;
                // Nachricht mit dekodierten Daten erweitern
                if (success) {
                    formattedMessage = `${message} - ${formatted.summary}`;
                }
            }
        }

        // QC-spezifische Status-Formatierung
        switch (status) {
            case 'qc_entrance_saved':
                qcStage = 'entrance';
                displayType = 'success';
                formattedMessage = 'Eingang erfasst - QC-Prüfung gestartet';
                if (decodedSummary) {
                    formattedMessage += ` (${decodedSummary})`;
                }
                break;

            case 'qc_exit_saved':
                qcStage = 'exit';
                displayType = 'success';
                formattedMessage = 'Ausgang erfasst - QC-Prüfung abgeschlossen';
                if (decodedSummary) {
                    formattedMessage += ` (${decodedSummary})`;
                }
                break;

            case 'duplicate_cache':
            case 'duplicate_database':
            case 'duplicate_transaction':
                if (duplicateInfo && duplicateInfo.minutesAgo !== undefined) {
                    formattedMessage = `QC-Duplikat: Bereits vor ${duplicateInfo.minutesAgo} Minuten gescannt`;
                } else if (duplicateInfo && duplicateInfo.count) {
                    formattedMessage = `QC-Duplikat: ${duplicateInfo.count}x bereits gescannt`;
                }
                displayType = 'duplicate';
                break;

            case 'rate_limit':
                formattedMessage = 'QC-Rate-Limit: Zu viele Scans - kurz warten';
                displayType = 'warning';
                break;

            case 'saved':
                if (data && data.ID) {
                    formattedMessage = `QC-Scan erfolgreich gespeichert (ID: ${data.ID})`;
                    if (decodedSummary) {
                        formattedMessage += ` - ${decodedSummary}`;
                    }
                }
                displayType = 'success';
                break;

            case 'error':
            case 'database_offline':
                displayType = 'error';
                formattedMessage = `QC-Fehler: ${formattedMessage}`;
                break;

            case 'processing':
                displayType = 'info';
                formattedMessage = `QC-Verarbeitung: ${formattedMessage}`;
                break;
        }

        return {
            success: success || false,
            message: formattedMessage,
            status: displayType,
            qcStage: qcStage,
            data: data || null,
            duplicateInfo: duplicateInfo || null,
            decodedSummary: decodedSummary,
            timestamp: new Date().toISOString()
        };
    },

    // ===== PARALLELE SESSION UTILITIES =====
    formatSessionInfo: (session) => {
        if (!session) return null;

        const duration = this.calculateSessionDuration(session.StartTS || session.localStartTime);

        return {
            id: session.ID,
            userId: session.UserID,
            userName: session.UserName || 'Unbekannt',
            department: session.Department || '',
            sessionType: session.SessionTypeName || 'Qualitätskontrolle',
            startTime: session.StartTS || session.localStartTime,
            duration: duration,
            durationFormatted: this.formatDuration(duration),
            scanCount: session.ScanCount || 0,
            isActive: session.Active === 1 || session.Active === true
        };
    },

    groupSessionsByUser: (sessions) => {
        const grouped = {};

        sessions.forEach(session => {
            const userId = session.UserID;
            if (!grouped[userId]) {
                grouped[userId] = {
                    user: {
                        id: userId,
                        name: session.UserName || 'Unbekannt',
                        department: session.Department || ''
                    },
                    sessions: []
                };
            }
            grouped[userId].sessions.push(this.formatSessionInfo(session));
        });

        return grouped;
    },

    // ===== QC-SPEZIFISCHE UTILITIES =====

    /**
     * Formatiert QC-Schritt für UI-Anzeige
     * @param {Object} qcStep - QC-Schritt Daten
     * @returns {Object} - Formatierte QC-Schritt Informationen
     */
    formatQCStep: (qcStep) => {
        if (!qcStep) return null;

        const statusInfo = this.getQCStepStatus(qcStep);
        const duration = this.calculateQCStepDuration(qcStep.StartTime, qcStep.EndTime);

        return {
            id: qcStep.ID,
            sessionId: qcStep.SessionID,
            qrCode: qcStep.QrCode,
            startTime: qcStep.StartTime,
            endTime: qcStep.EndTime,
            completed: qcStep.Completed,
            duration: duration,
            durationFormatted: this.formatDuration(duration),
            status: statusInfo.status,
            stage: statusInfo.stage,
            icon: statusInfo.icon,
            description: statusInfo.description,
            startScanId: qcStep.StartScanID,
            endScanId: qcStep.EndScanID
        };
    },

    /**
     * Gruppiert QC-Schritte nach Status
     * @param {Array} qcSteps - Array von QC-Schritten
     * @returns {Object} - Gruppierte QC-Schritte
     */
    groupQCStepsByStatus: (qcSteps) => {
        const grouped = {
            active: [],
            completed: [],
            pending: []
        };

        qcSteps.forEach(step => {
            const formatted = this.formatQCStep(step);
            if (formatted) {
                grouped[formatted.status].push(formatted);
            }
        });

        return grouped;
    },

    // ===== COPY TO CLIPBOARD FUNKTIONALITÄT =====
    copyToClipboard: async (text) => {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            } else {
                // Fallback für ältere Browser
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();

                const result = document.execCommand('copy');
                document.body.removeChild(textArea);
                return result;
            }
        } catch (error) {
            console.error('Clipboard-Fehler:', error);
            return false;
        }
    },

    // ===== ZAHLKONVERTIERUNG =====
    hexToDecimal: (hex) => {
        try {
            const cleaned = hex.toString().replace(/[^0-9A-Fa-f]/g, '');
            return parseInt(cleaned, 16);
        } catch (error) {
            return null;
        }
    },

    decimalToHex: (decimal) => {
        try {
            return Number(decimal).toString(16).toUpperCase();
        } catch (error) {
            return null;
        }
    },

    // ===== PERFORMANCE UTILITIES =====
    debounce: (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },

    throttle: (func, limit) => {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    },

    // ===== DATENVERARBEITUNG =====
    formatFileSize: (bytes) => {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    generateRandomTag: () => {
        const chars = '0123456789ABCDEF';
        let result = '';
        for (let i = 0; i < 10; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    },

    // ===== ERROR HANDLING =====
    createErrorInfo: (error, context = null) => {
        const errorInfo = {
            message: error?.message || String(error),
            stack: error?.stack,
            name: error?.name,
            code: error?.code,
            context: context,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href
        };

        // Zusätzliche Informationen für spezielle Fehler
        if (error?.name === 'NotAllowedError') {
            errorInfo.suggestion = 'Kamera-Berechtigung verweigert - in den Browsereinstellungen erlauben';
        } else if (error?.name === 'NotFoundError') {
            errorInfo.suggestion = 'Keine Kamera gefunden - USB-Kamera anschließen';
        } else if (error?.name === 'OverconstrainedError') {
            errorInfo.suggestion = 'Kamera-Einstellungen nicht unterstützt - andere Auflösung versuchen';
        }

        return errorInfo;
    },

    // ===== LOGGING =====
    log: (level, message, data = null) => {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] QC-${level.toUpperCase()}: ${message}`;

        switch (level.toLowerCase()) {
            case 'error':
                console.error(logMessage, data);
                break;
            case 'warn':
                console.warn(logMessage, data);
                break;
            case 'info':
                console.info(logMessage, data);
                break;
            case 'debug':
                if (window.config && window.config.isDev()) {
                    console.log(logMessage, data);
                }
                break;
            default:
                console.log(logMessage, data);
        }
    },

    // ===== VALIDIERUNG =====
    isValidEmail: (email) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },

    sanitizeString: (str) => {
        if (typeof str !== 'string') return '';
        return str.replace(/[<>"/\\&]/g, '');
    },

    truncateString: (str, maxLength = 50) => {
        if (typeof str !== 'string') return '';
        return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
    },

    // ===== STORAGE HELPERS =====
    safeJSONParse: (str, fallback = null) => {
        try {
            return JSON.parse(str);
        } catch (error) {
            console.warn('JSON Parse Fehler:', error);
            return fallback;
        }
    },

    safeJSONStringify: (obj, fallback = '{}') => {
        try {
            return JSON.stringify(obj);
        } catch (error) {
            console.warn('JSON Stringify Fehler:', error);
            return fallback;
        }
    }
});

// ===== KONFIGURATION & UMGEBUNG =====
contextBridge.exposeInMainWorld('config', {
    get: (key) => {
        const allowedKeys = [
            'NODE_ENV',
            'UI_WINDOW_WIDTH',
            'UI_WINDOW_HEIGHT',
            'APP_DEBUG',
            'UI_THEME',
            'UI_UPDATE_INTERVAL',
            'QC_MAX_ACTIVE_STEPS',
            'QC_STEP_TIMEOUT_MINUTES'
        ];

        if (allowedKeys.includes(key)) {
            return process.env[key];
        }
        return undefined;
    },

    isDev: () => process.env.NODE_ENV === 'development',
    version: null, // Wird später von der App gesetzt

    // ===== THEME MANAGEMENT =====
    theme: {
        get: () => {
            try {
                return localStorage.getItem('quality-control-theme') || 'auto';
            } catch {
                return 'auto';
            }
        },

        set: (theme) => {
            try {
                localStorage.setItem('quality-control-theme', theme);
                document.body.className = document.body.className.replace(/theme-\w+/g, '');

                if (theme === 'auto') {
                    // System-Präferenz verwenden
                    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                        document.body.classList.add('theme-dark');
                    } else {
                        document.body.classList.add('theme-light');
                    }
                } else {
                    document.body.classList.add(`theme-${theme}`);
                }
            } catch (error) {
                console.warn('Theme setzen fehlgeschlagen:', error);
            }
        },

        toggle: () => {
            const current = config.theme.get();
            const next = current === 'dark' ? 'light' : current === 'light' ? 'auto' : 'dark';
            config.theme.set(next);
            return next;
        }
    }
});

// ===== DIAGNOSTICS & ERROR HANDLING =====
contextBridge.exposeInMainWorld('diagnostics', {
    collectSystemInfo: async () => {
        try {
            const systemInfo = await window.electronAPI.system.getInfo();
            const systemStatus = await window.electronAPI.system.getStatus();
            const rfidStatus = await window.electronAPI.rfid.getStatus();

            return {
                timestamp: new Date().toISOString(),
                system: systemInfo,
                status: systemStatus,
                rfid: rfidStatus,
                browser: {
                    userAgent: navigator.userAgent,
                    language: navigator.language,
                    cookieEnabled: navigator.cookieEnabled,
                    onLine: navigator.onLine
                },
                screen: {
                    width: screen.width,
                    height: screen.height,
                    colorDepth: screen.colorDepth,
                    pixelDepth: screen.pixelDepth
                },
                performance: performance.memory ? {
                    used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
                    total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
                    limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024)
                } : null,
                localStorage: (() => {
                    try {
                        return {
                            available: typeof Storage !== 'undefined',
                            theme: localStorage.getItem('quality-control-theme')
                        };
                    } catch {
                        return { available: false };
                    }
                })()
            };
        } catch (error) {
            return {
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    },

    exportDiagnostics: async () => {
        try {
            const systemInfo = await diagnostics.collectSystemInfo();
            const logs = window.logs || [];

            return {
                ...systemInfo,
                logs: logs.slice(-100), // Letzte 100 Log-Einträge
                exportTime: new Date().toISOString()
            };
        } catch (error) {
            return {
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
});

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('Preload Script für Qualitätskontrolle geladen, DOM bereit');

    // Theme initialisieren
    const savedTheme = localStorage.getItem('quality-control-theme') || 'auto';
    config.theme.set(savedTheme);

    // System Theme Changes verfolgen
    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            const currentTheme = localStorage.getItem('quality-control-theme') || 'auto';
            if (currentTheme === 'auto') {
                config.theme.set('auto'); // Theme neu anwenden
            }
        });
    }

    // Global Error Handler
    window.addEventListener('error', (event) => {
        const errorInfo = {
            message: event.error?.message || event.message,
            stack: event.error?.stack,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            timestamp: new Date().toISOString()
        };

        console.error('Global QC Error:', errorInfo);
        utils.log('error', 'Global JavaScript Error', errorInfo);
    });

    // Unhandled Promise Rejections
    window.addEventListener('unhandledrejection', (event) => {
        const errorInfo = {
            reason: event.reason,
            promise: event.promise,
            timestamp: new Date().toISOString()
        };

        console.error('Unhandled QC Promise Rejection:', errorInfo);
        utils.log('error', 'Unhandled Promise Rejection', errorInfo);
    });

    // Log-Array für Diagnostics
    window.logs = window.logs || [];

    // Console-Methoden erweitern für Log-Sammlung
    const originalConsoleError = console.error;
    console.error = (...args) => {
        window.logs.push({
            level: 'error',
            message: args.join(' '),
            timestamp: new Date().toISOString()
        });
        originalConsoleError.apply(console, args);
    };

    const originalConsoleWarn = console.warn;
    console.warn = (...args) => {
        window.logs.push({
            level: 'warn',
            message: args.join(' '),
            timestamp: new Date().toISOString()
        });
        originalConsoleWarn.apply(console, args);
    };

    console.log('✅ Preload Script für Qualitätskontrolle mit parallelen Sessions erfolgreich initialisiert');
});

console.log('Preload Script für Qualitätskontrolle mit QC-spezifischen APIs geladen');