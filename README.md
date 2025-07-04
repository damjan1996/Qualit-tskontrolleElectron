# 📦 Wareneinlagerung RFID QR - Vereinfachte Version

**Moderne Desktop-Anwendung für RFID-basierte Zeiterfassung und QR-Code Wareneinlagerung**

Speziell optimiert für den Wareneinlagerung bei Shirtful - Fokus auf einfache Bedienung und zuverlässige Funktion.

## ✨ Hauptfeatures

### 🏷️ RFID-Anmeldung
- **Ein-Klick-Anmeldung** durch RFID-Tag scannen
- **Automatische Zeiterfassung** mit Live-Timer
- **Ein Benutzer aktiv** - Fokus auf einzelne Arbeitsplätze
- **Sofortige Ab-/Anmeldung** durch erneutes Tag-Scannen

### 📸 QR-Code Wareneinlagerung
- **Live-Kamera-Vorschau** mit optimierter Scan-Oberfläche
- **Automatische QR-Erkennung** ohne manuellen Auslöser
- **Duplikat-Vermeidung** (global + session-basiert)
- **Visuelles & Audio-Feedback** bei erfolgreichen Scans
- **Scan-Historie** mit zeitlicher Nachverfolgung

### 🎯 Vereinfachte Bedienung
- **Reduzierte UI** - nur relevante Informationen
- **Große Schaltflächen** für Touch-Bedienung geeignet
- **Klare Status-Anzeigen** für System und Scanner
- **Minimal-Setup** mit automatischer Konfiguration

## 🛠️ Technologie

| Komponente | Lösung | Grund |
|------------|---------|--------|
| **Desktop** | Electron 27+ | Native Desktop-App mit Web-UI |
| **Backend** | Node.js 16+ | RFID/Database-Integration |
| **Frontend** | Vanilla JS/HTML/CSS | Einfach wartbar, keine Framework-Abhängigkeiten |
| **Datenbank** | Microsoft SQL Server | Direkte Integration mit mssql-Package |
| **RFID** | Keyboard-Listener | HID-Tastatur-Emulation (Standard RFID-Reader) |
| **QR-Scanner** | jsQR + WebRTC | Browser-basierte Kamera-Integration |

## 📋 Voraussetzungen

### Software
- **Windows 10/11** (primäre Zielplattform)
- **Node.js 16+** - [Download](https://nodejs.org/)
- **SQL Server ODBC Driver** - [Download](https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server)

### Hardware
- **RFID-Reader** (HID-Tastatur-Modus)
- **Webcam** für QR-Code-Scanning
- **Netzwerk-Zugriff** auf SQL Server

## 🚀 Installation

### 1. Projekt einrichten
```bash
# Repository klonen oder Dateien entpacken
cd Wareneinlagerung-rfid-qr

# Dependencies installieren
npm install

# Automatisches Setup
npm run setup
```

### 2. Konfiguration
Das Setup-Script führt Sie durch die Konfiguration:

- **Datenbank-Verbindung** (SQL Server Details)
- **UI-Einstellungen** (Fenstergröße, Theme)
- **Scanner-Optionen** (Cooldown, Audio-Feedback)

Alternativ: `.env.example` zu `.env` kopieren und manuell anpassen.

### 3. Datenbank vorbereiten
```bash
# Datenbank-Schema erstellen
npm run setup-db

# Testbenutzer anlegen
npm run setup-users

# Verbindung testen
npm run test-db
```

### 4. Hardware einrichten

**RFID-Reader:**
1. An USB anschließen
2. Als HID-Tastatur konfigurieren
3. Test in Notepad: Tag scannen → Text + Enter erscheint

**Webcam:**
1. USB-Webcam anschließen oder integrierte verwenden
2. Kamera-Berechtigung erteilen
3. Optimal: Rückkamera für bessere QR-Erkennung

## 🎮 Bedienung

### Login-Prozess
1. **RFID-Tag scannen** → Automatische Anmeldung
2. **Timer startet** → Arbeitszeit-Erfassung beginnt
3. **QR-Scanner aktivieren** → "Scanner starten" klicken
4. **Pakete scannen** → QR-Codes vor Kamera halten
5. **Abmelden** → Gleiches RFID-Tag erneut scannen

### QR-Code Scanning
- **Automatische Erkennung** - kein Button-Druck nötig
- **Visuelles Feedback** - grüner Bildschirm bei Erfolg
- **Audio-Signal** - Bestätigungston (optional)
- **Duplikat-Schutz** - verhindert versehentliche Doppelscans
- **Live-Historie** - letzte 10 Scans sichtbar

### Status-Informationen
- **Aktueller Benutzer** mit Live-Timer
- **Scan-Anzahl** der aktuellen Session
- **System-Status** (Datenbank, RFID, Kamera)
- **Letzte Scan-Zeit** und Erfolgs-Rate

## ⚙️ Konfiguration

### Wichtige .env Einstellungen

```env
# Datenbank
MSSQL_SERVER=116.202.224.248
MSSQL_DATABASE=RdScanner
MSSQL_USER=sa
MSSQL_PASSWORD=IhrPasswort

# QR-Scanner
QR_GLOBAL_COOLDOWN=300        # 5 Min zwischen Duplikaten
SCAN_SUCCESS_DURATION=2000    # 2s Erfolgs-Overlay
AUDIO_FEEDBACK=true           # Audio-Bestätigung

# UI
UI_WINDOW_WIDTH=1400          # Fensterbreite
UI_WINDOW_HEIGHT=900          # Fensterhöhe
UI_THEME=auto                 # auto/light/dark

# RFID
RFID_MIN_SCAN_INTERVAL=1000   # 1s zwischen RFID-Scans
```

### Performance-Optimierung

**Langsame Hardware:**
```env
UI_UPDATE_INTERVAL=2000       # Weniger UI-Updates
QR_GLOBAL_COOLDOWN=600        # Längeres Cooldown
CAMERA_RESOLUTION_WIDTH=640   # Geringere Auflösung
```

**Hochfrequenz-Betrieb:**
```env
RFID_MIN_SCAN_INTERVAL=500    # Schnellere RFID-Scans
QR_GLOBAL_COOLDOWN=60         # Kürzeres Cooldown
MAX_RECENT_SCANS=20           # Mehr Historie
```

## 🔧 Troubleshooting

### RFID-Reader Probleme

❌ **"Kein RFID-Reader erkannt"**
```bash
1. USB-Verbindung prüfen
2. Windows erkennt als "HID-Tastatur"?
3. Test in Notepad - erscheint Tag-ID + Enter?
4. Andere RFID-Software schließen
5. Als Administrator starten
```

✅ **Lösung:**
- Reader auf HID-Keyboard-Modus umstellen
- `RFID_MIN_SCAN_INTERVAL=500` reduzieren
- USB-Port wechseln

### Kamera-Probleme

❌ **"Kamera-Zugriff fehlgeschlagen"**
```bash
1. Kamera-Berechtigung in Windows erlauben
2. Andere Apps schließen (Teams, Skype, etc.)
3. Browser-Cache leeren
4. Anwendung als Administrator starten
```

✅ **Lösung:**
- Windows-Einstellungen → Datenschutz → Kamera
- Andere Kamera-Apps beenden
- USB-Kamera verwenden falls integrierte nicht funktioniert

### Datenbank-Verbindung

❌ **"Connection failed"**
```bash
1. Netzwerk: ping 116.202.224.248
2. Port: telnet 116.202.224.248 1433
3. Firewall-Regeln prüfen
4. SQL Server Authentication aktiviert?
```

✅ **Lösung:**
```env
MSSQL_TRUST_CERT=true
MSSQL_ENCRYPT=false
MSSQL_CONNECTION_TIMEOUT=30000
```

## 📊 Datenbankstruktur

### Haupttabellen
- **ScannBenutzer** - Mitarbeiterdaten mit EPC (RFID)
- **Sessions** - Arbeitszeit-Sessions (Start/End)
- **QrScans** - Erfasste QR-Codes mit Timestamp

### Session-Logik
```sql
-- Neue Session starten
INSERT INTO Sessions (UserID, StartTS, Active) VALUES (?, SYSDATETIME(), 1)

-- Session beenden
UPDATE Sessions SET EndTS = SYSDATETIME(), Active = 0 WHERE ID = ?

-- QR-Scan speichern
INSERT INTO QrScans (SessionID, RawPayload, CapturedTS) VALUES (?, ?, SYSDATETIME())
```

## 🔄 Updates & Wartung

### Entwicklung
```bash
# Development Mode
npm run dev

# Debug mit Inspector
npm run debug

# Quick-Test der DB-Verbindung
npm run test-quick
```

### Produktions-Build
```bash
# Windows Installer erstellen
npm run build:win

# Ausgabe: dist/Wareneinlagerung RFID QR Setup.exe
```

### Datenbank-Wartung
```bash
# Neue Testbenutzer anlegen
npm run setup-users

# Tabellen-Status prüfen
npm run test-db

# Schema-Updates
npm run setup-db
```

## 🛡️ Sicherheit

### Produktions-Härtung
```env
NODE_ENV=production
APP_DEBUG=false
MSSQL_ENCRYPT=true
MSSQL_TRUST_CERT=false
```

### Datenschutz
- Keine persönlichen Daten in QR-Codes
- RFID-Tags als anonyme IDs
- Lokale Datenverarbeitung (keine Cloud)
- Automatische Session-Bereinigung

## 📈 Monitoring

### Live-Status
- **System-Status** in Header (grün/rot)
- **Verbindungszeit** zur Datenbank
- **Scan-Rate** und Erfolgsquote
- **Session-Dauer** Live-Timer

### Logs
```
logs/
├── main.log              # Hauptanwendung
├── database.log          # SQL-Operationen
└── rfid.log              # RFID-Events
```

### Health-Check
```javascript
// Verfügbar über UI oder IPC
await window.electronAPI.system.getStatus();
// Returns: { database, rfid, uptime, errors }
```

## 🆚 Unterschiede zur Original-Version

| Feature | Original | **Vereinfacht** |
|---------|----------|----------------|
| **Multi-User** | ✅ Mehrere gleichzeitig | ❌ Ein Benutzer |
| **QR-Zuordnung** | Manual/Round-Robin/Last | ✅ Automatisch an User |
| **UI-Komplexität** | Viele Panels | ✅ Fokussierte Ansicht |
| **Setup** | Manual | ✅ Guided Setup |
| **Features** | Alle Module | ✅ Nur Wareneinlagerung |
| **Performance** | 80-120 MB RAM | ✅ 60-90 MB RAM |
| **Bedienung** | Komplex | ✅ Ein-Klick-Workflow |

## 🎯 Roadmap

### Phase 1 (Aktuell)
- ✅ Grundfunktionen implementiert
- ✅ RFID + QR-Scanner Integration
- ✅ Vereinfachte UI

### Phase 2 (Geplant)
- 📊 Tagesstatistiken-Dashboard
- 🔄 Auto-Update Funktionalität
- 📱 Mobile Web-Interface (optional)

### Phase 3 (Future)
- 🏭 Multi-Station Support
- 📈 Reporting-Module
- 🔌 API für externe Systeme

## 📞 Support

**Bei Problemen:**
1. **Logs prüfen**: `logs/` Verzeichnis
2. **Health-Check**: "System-Status" in UI
3. **Quick-Test**: `npm run test-quick`
4. **Vollständiger Test**: `npm test`

**Häufige Probleme:**
- RFID nicht erkannt → Hardware-Setup prüfen
- Kamera-Fehler → Berechtigungen/andere Apps
- DB-Verbindung → Netzwerk/Firewall
- Performance → .env Optimierung

---

## 🏭 Shirtful Integration

Diese Anwendung ist speziell für den Wareneinlagerung bei Shirtful optimiert:

- **Einfacher Workflow**: RFID scannen → QR-Codes erfassen
- **Robuste Hardware-Integration**: Standard USB-Geräte
- **Zuverlässige Datenerfassung**: Direkte SQL Server Anbindung
- **Benutzerfreundlich**: Minimal-UI für effiziente Bedienung

**Perfekt für**: Wareneinlagerung, Qualitätskontrolle, Versand-Stationen

✅ **Produktionsbereit** - Sofort einsetzbar nach Setup!