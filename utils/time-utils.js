/**
 * Zentrale Zeitbehandlungs-Utilities für RFID-Wareneinlagerung
 * Behandelt alle Zeitstempel-Konvertierungen zwischen SQL Server und JavaScript
 */

class TimeUtils {
    constructor() {
        // Deutsche Zeitzone für konsistente Formatierung
        this.timezone = 'Europe/Berlin';
        this.locale = 'de-DE';
    }

    /**
     * Normalisiert einen Zeitstempel von SQL Server zu ISO-String
     * @param {*} timestamp - SQL Server Zeitstempel (verschiedene Formate möglich)
     * @returns {string} - ISO-String (YYYY-MM-DDTHH:mm:ss.sssZ)
     */
    normalizeTimestamp(timestamp) {
        try {
            if (!timestamp) {
                console.warn('TimeUtils: Leerer Zeitstempel erhalten');
                return new Date().toISOString();
            }

            let date;

            if (timestamp instanceof Date) {
                date = timestamp;
            } else if (typeof timestamp === 'string') {
                // SQL Server Format-Varianten handhaben
                if (timestamp.includes('T')) {
                    // ISO-Format: "2024-06-24T13:01:30.000Z"
                    date = new Date(timestamp);
                } else {
                    // SQL Server Format: "2024-06-24 13:01:30.000"
                    const isoString = timestamp.replace(' ', 'T');
                    // Z hinzufügen falls nicht vorhanden
                    date = new Date(isoString.endsWith('Z') ? isoString : isoString + 'Z');
                }
            } else if (typeof timestamp === 'number') {
                // Unix-Zeitstempel
                date = new Date(timestamp);
            } else {
                // Fallback: Versuche direkte Konvertierung
                date = new Date(timestamp);
            }

            // Validierung
            if (!date || isNaN(date.getTime())) {
                console.warn('TimeUtils: Ungültiger Zeitstempel:', timestamp);
                return new Date().toISOString();
            }

            return date.toISOString();

        } catch (error) {
            console.error('TimeUtils: Fehler bei Zeitstempel-Normalisierung:', error, timestamp);
            return new Date().toISOString();
        }
    }

    /**
     * Berechnet die Dauer zwischen zwei Zeitstempeln in Sekunden
     * @param {*} startTime - Start-Zeitstempel
     * @param {*} endTime - End-Zeitstempel (optional, default: jetzt)
     * @returns {number} - Dauer in Sekunden
     */
    calculateDurationSeconds(startTime, endTime = null) {
        try {
            const start = new Date(this.normalizeTimestamp(startTime));
            const end = endTime ? new Date(this.normalizeTimestamp(endTime)) : new Date();

            const durationMs = end.getTime() - start.getTime();

            // Negative Zeiten abfangen
            if (durationMs < 0) {
                console.warn('TimeUtils: Negative Dauer erkannt:', { startTime, endTime });
                return 0;
            }

            return Math.floor(durationMs / 1000);

        } catch (error) {
            console.error('TimeUtils: Fehler bei Dauer-Berechnung:', error);
            return 0;
        }
    }

    /**
     * Formatiert Sekunden zu HH:MM:SS Format
     * @param {number} seconds - Sekunden
     * @returns {string} - Formatierte Zeit (HH:MM:SS)
     */
    formatDuration(seconds) {
        if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
            console.warn('TimeUtils: Ungültige Sekunden für formatDuration:', seconds);
            return '00:00:00';
        }

        const totalSeconds = Math.floor(seconds);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;

        // Begrenzte maximale Anzeige (999 Stunden)
        const displayHours = Math.min(hours, 999);

        return [displayHours, minutes, secs]
            .map(v => v.toString().padStart(2, '0'))
            .join(':');
    }

    /**
     * Formatiert einen Zeitstempel für deutsche Anzeige
     * @param {*} timestamp - Zeitstempel
     * @param {string} format - Format ('time', 'date', 'datetime', 'short')
     * @returns {string} - Formatierte Zeit
     */
    formatTimestamp(timestamp, format = 'datetime') {
        try {
            const normalizedTimestamp = this.normalizeTimestamp(timestamp);
            const date = new Date(normalizedTimestamp);

            if (isNaN(date.getTime())) {
                return 'Ungültiges Datum';
            }

            const options = {
                timeZone: this.timezone,
            };

            switch (format) {
                case 'time':
                    return date.toLocaleTimeString(this.locale, {
                        ...options,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    });

                case 'date':
                    return date.toLocaleDateString(this.locale, {
                        ...options,
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    });

                case 'datetime':
                    return date.toLocaleString(this.locale, {
                        ...options,
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    });

                case 'short':
                    return date.toLocaleString(this.locale, {
                        ...options,
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    });

                case 'relative':
                    return this.getRelativeTime(date);

                default:
                    return date.toLocaleString(this.locale, {
                        ...options,
                        hour12: false
                    });
            }

        } catch (error) {
            console.error('TimeUtils: Fehler bei Zeitformatierung:', error);
            return 'Formatfehler';
        }
    }

    /**
     * Berechnet relative Zeit ("vor 5 Minuten")
     * @param {Date|string} date - Datum
     * @returns {string} - Relative Zeitangabe
     */
    getRelativeTime(date) {
        try {
            const now = new Date();
            const targetDate = new Date(this.normalizeTimestamp(date));

            if (isNaN(targetDate.getTime())) {
                return 'Ungültiges Datum';
            }

            const diffMs = now.getTime() - targetDate.getTime();
            const diffSecs = Math.floor(Math.abs(diffMs) / 1000);
            const diffMins = Math.floor(diffSecs / 60);
            const diffHours = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHours / 24);

            const prefix = diffMs < 0 ? 'in ' : 'vor ';

            if (diffSecs < 5) return 'gerade eben';
            if (diffSecs < 60) return `${prefix}${diffSecs} Sekunde${diffSecs !== 1 ? 'n' : ''}`;
            if (diffMins < 60) return `${prefix}${diffMins} Minute${diffMins !== 1 ? 'n' : ''}`;
            if (diffHours < 24) return `${prefix}${diffHours} Stunde${diffHours !== 1 ? 'n' : ''}`;
            if (diffDays < 7) return `${prefix}${diffDays} Tag${diffDays !== 1 ? 'en' : ''}`;

            return targetDate.toLocaleDateString(this.locale);

        } catch (error) {
            console.error('TimeUtils: Fehler bei relativer Zeitberechnung:', error);
            return 'Unbekannt';
        }
    }

    /**
     * Konvertiert JavaScript Date zu SQL Server DateTime String
     * @param {Date} date - JavaScript Date Objekt
     * @returns {string} - SQL Server DateTime Format
     */
    toSQLDateTime(date = new Date()) {
        try {
            if (!(date instanceof Date)) {
                date = new Date(date);
            }

            if (isNaN(date.getTime())) {
                date = new Date();
            }

            // SQL Server Format: YYYY-MM-DD HH:mm:ss.fff
            return date.toISOString().slice(0, 23).replace('T', ' ');

        } catch (error) {
            console.error('TimeUtils: Fehler bei SQL-DateTime-Konvertierung:', error);
            return new Date().toISOString().slice(0, 23).replace('T', ' ');
        }
    }

    /**
     * Erstellt einen Session-Timer der sich automatisch aktualisiert
     * @param {*} startTime - Session-Startzeit
     * @param {Function} updateCallback - Callback-Funktion für Updates
     * @returns {object} - Timer-Objekt mit start/stop Methoden
     */
    createSessionTimer(startTime, updateCallback) {
        let interval = null;

        const update = () => {
            try {
                const duration = this.calculateDurationSeconds(startTime);
                const formatted = this.formatDuration(duration);
                updateCallback(formatted, duration);
            } catch (error) {
                console.error('TimeUtils: Session-Timer Fehler:', error);
                updateCallback('00:00:00', 0);
            }
        };

        return {
            start: () => {
                if (interval) this.stop();
                update(); // Sofortige erste Anzeige
                interval = setInterval(update, 1000);
            },

            stop: () => {
                if (interval) {
                    clearInterval(interval);
                    interval = null;
                }
            },

            isRunning: () => interval !== null,

            update: update // Manuelle Update-Möglichkeit
        };
    }

    /**
     * Validiert einen Zeitstempel
     * @param {*} timestamp - Zu validierender Zeitstempel
     * @returns {boolean} - true wenn gültig
     */
    isValidTimestamp(timestamp) {
        try {
            const normalized = this.normalizeTimestamp(timestamp);
            const date = new Date(normalized);
            return !isNaN(date.getTime());
        } catch {
            return false;
        }
    }

    /**
     * Aktuelle Zeit als ISO-String
     * @returns {string} - Aktuelle Zeit als ISO-String
     */
    now() {
        return new Date().toISOString();
    }

    /**
     * Heutiges Datum als YYYY-MM-DD String
     * @returns {string} - Heutiges Datum
     */
    today() {
        return new Date().toISOString().split('T')[0];
    }

    /**
     * Debug-Informationen für Zeitstempel-Probleme
     * @param {*} timestamp - Problematischer Zeitstempel
     * @returns {object} - Debug-Informationen
     */
    debugTimestamp(timestamp) {
        return {
            input: timestamp,
            inputType: typeof timestamp,
            inputConstructor: timestamp?.constructor?.name,
            normalized: this.normalizeTimestamp(timestamp),
            isValid: this.isValidTimestamp(timestamp),
            parsed: new Date(this.normalizeTimestamp(timestamp)),
            formatted: this.formatTimestamp(timestamp),
            timestamp: Date.now()
        };
    }
}

// Singleton-Instanz für globale Verwendung
const timeUtils = new TimeUtils();

module.exports = timeUtils;