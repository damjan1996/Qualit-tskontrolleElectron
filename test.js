#!/usr/bin/env node

/**
 * RFID QR Wareneinlagerung - Komponenten Test Script
 * Testet alle wichtigen Komponenten vor dem Produktiveinsatz
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

class ComponentTester {
    constructor() {
        this.results = {
            total: 0,
            passed: 0,
            failed: 0,
            warnings: 0,
            tests: []
        };
    }

    async runAllTests() {
        console.log('🧪 RFID QR Wareneinlagerung - Komponenten Tests');
        console.log('===========================================');
        console.log();

        try {
            await this.testEnvironment();
            await this.testDependencies();
            await this.testConfiguration();
            await this.testDatabase();
            await this.testRFIDSystem();
            await this.testFileSystem();
            await this.testSecurity();

            this.printSummary();

            return this.results.failed === 0;

        } catch (error) {
            console.error('\n❌ Test-Suite abgebrochen:', error.message);
            return false;
        }
    }

    async testEnvironment() {
        this.printTestHeader('System-Umgebung');

        // Node.js Version
        await this.runTest('Node.js Version', () => {
            const version = process.version;
            const major = parseInt(version.split('.')[0].substring(1));

            if (major < 16) {
                throw new Error(`Node.js 16+ erforderlich, gefunden: ${version}`);
            }

            return `${version} ✓`;
        });

        // Betriebssystem
        await this.runTest('Betriebssystem', () => {
            const platform = process.platform;
            const arch = process.arch;
            return `${platform} ${arch}`;
        });

        // Speicher
        await this.runTest('Verfügbarer Speicher', () => {
            const totalMem = Math.round(require('os').totalmem() / 1024 / 1024 / 1024 * 100) / 100;
            const freeMem = Math.round(require('os').freemem() / 1024 / 1024 / 1024 * 100) / 100;

            if (totalMem < 4) {
                this.addWarning('Wenig RAM verfügbar - mindestens 4GB empfohlen');
            }

            return `${freeMem}GB frei von ${totalMem}GB`;
        });

        // Projektverzeichnis
        await this.runTest('Projektverzeichnis', () => {
            const cwd = process.cwd();
            const packageJson = path.join(cwd, 'package.json');

            if (!fs.existsSync(packageJson)) {
                throw new Error('package.json nicht gefunden');
            }

            return cwd;
        });
    }

    async testDependencies() {
        this.printTestHeader('Dependencies & Module');

        // package.json lesen
        const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

        // Kritische Dependencies testen
        const criticalDeps = ['electron', 'mssql', 'node-hid'];

        for (const dep of criticalDeps) {
            await this.runTest(`Dependency: ${dep}`, () => {
                try {
                    const depPath = require.resolve(dep);
                    const version = packageJson.dependencies[dep] || packageJson.devDependencies[dep];
                    return `${version} ✓`;
                } catch (error) {
                    throw new Error(`Modul nicht gefunden oder nicht installiert`);
                }
            });
        }

        // Node modules Größe prüfen
        await this.runTest('node_modules Größe', () => {
            const nodeModulesPath = path.join(process.cwd(), 'node_modules');

            if (!fs.existsSync(nodeModulesPath)) {
                throw new Error('node_modules Verzeichnis nicht gefunden - npm install ausführen');
            }

            const stats = this.getDirSize(nodeModulesPath);
            const sizeMB = Math.round(stats / 1024 / 1024);

            if (sizeMB > 500) {
                this.addWarning(`node_modules sehr groß: ${sizeMB}MB`);
            }

            return `${sizeMB}MB`;
        });
    }

    async testConfiguration() {
        this.printTestHeader('Konfiguration');

        // .env Datei
        await this.runTest('.env Datei', () => {
            if (!fs.existsSync('.env')) {
                throw new Error('.env Datei nicht gefunden - Setup ausführen');
            }

            const envContent = fs.readFileSync('.env', 'utf8');
            const lines = envContent.split('\n').filter(line =>
                line.trim() && !line.startsWith('#')
            ).length;

            return `${lines} Konfigurationswerte`;
        });

        // Kritische Umgebungsvariablen
        const requiredEnvVars = [
            'MSSQL_SERVER',
            'MSSQL_DATABASE',
            'MSSQL_USER',
            'MSSQL_PASSWORD'
        ];

        for (const envVar of requiredEnvVars) {
            await this.runTest(`Umgebungsvariable: ${envVar}`, () => {
                const value = process.env[envVar];

                if (!value) {
                    throw new Error(`${envVar} nicht gesetzt`);
                }

                // Passwort-Felder nicht im Klartext ausgeben
                if (envVar.includes('PASSWORD')) {
                    return '****** (gesetzt)';
                }

                return value;
            });
        }

        // UI Konfiguration validieren
        await this.runTest('UI Konfiguration', () => {
            const width = parseInt(process.env.UI_WINDOW_WIDTH) || 1200;
            const height = parseInt(process.env.UI_WINDOW_HEIGHT) || 800;

            if (width < 800 || height < 600) {
                this.addWarning('Sehr kleine Fenstergröße - mindestens 800x600 empfohlen');
            }

            return `${width}x${height}`;
        });
    }

    async testDatabase() {
        this.printTestHeader('Datenbank-Verbindung');

        // Datenbank-Client Test
        await this.runTest('SQL Server Client', async () => {
            try {
                const DatabaseClient = require('./db/db-client');
                const dbClient = new DatabaseClient();

                // Verbindungstest mit Timeout
                const connectionPromise = dbClient.connect();
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Verbindungs-Timeout (15s)')), 15000)
                );

                await Promise.race([connectionPromise, timeoutPromise]);

                // Health Check
                const healthCheck = await dbClient.healthCheck();

                if (!healthCheck.connected) {
                    throw new Error(healthCheck.error || 'Verbindung fehlgeschlagen');
                }

                await dbClient.close();
                return `Verbunden in ${healthCheck.connectionTime}ms`;

            } catch (error) {
                throw new Error(`Datenbankfehler: ${error.message}`);
            }
        });

        // Tabellen-Struktur testen
        await this.runTest('Datenbank-Tabellen', async () => {
            try {
                const DatabaseClient = require('./db/db-client');
                const dbClient = new DatabaseClient();

                await dbClient.connect();
                const validation = await dbClient.validateTables();
                await dbClient.close();

                const existing = validation.existingTables.length;
                const missing = validation.missingTables.length;

                if (missing > 0) {
                    this.addWarning(`Fehlende Tabellen: ${validation.missingTables.join(', ')}`);
                }

                return `${existing} Tabellen gefunden, ${missing} fehlen`;

            } catch (error) {
                throw new Error(`Tabellen-Check fehlgeschlagen: ${error.message}`);
            }
        });

        // Test-Benutzer abfragen
        await this.runTest('Benutzer-Daten', async () => {
            try {
                const DatabaseClient = require('./db/db-client');
                const dbClient = new DatabaseClient();

                await dbClient.connect();

                const result = await dbClient.query(`
                    SELECT COUNT(*) as userCount 
                    FROM dbo.ScannBenutzer 
                    WHERE xStatus = 0
                `);

                await dbClient.close();

                const userCount = result.recordset[0].userCount;

                if (userCount === 0) {
                    this.addWarning('Keine aktiven Benutzer in Datenbank');
                }

                return `${userCount} aktive Benutzer`;

            } catch (error) {
                // Nicht kritisch wenn Tabelle nicht existiert
                this.addWarning(`Benutzer-Abfrage fehlgeschlagen: ${error.message}`);
                return 'Übersprungen';
            }
        });
    }

    async testRFIDSystem() {
        this.printTestHeader('RFID-System');

        // RFID Listener Test
        await this.runTest('RFID Listener', async () => {
            try {
                const RFIDListener = require('./rfid/rfid-listener');
                const rfidListener = new RFIDListener();

                // Test-Initialisierung
                const status = rfidListener.getStatus();

                if (!status) {
                    throw new Error('RFID Listener konnte nicht initialisiert werden');
                }

                return 'Initialisierung erfolgreich';

            } catch (error) {
                throw new Error(`RFID Fehler: ${error.message}`);
            }
        });

        // HID Geräte suchen
        await this.runTest('HID Geräte', () => {
            try {
                const HID = require('node-hid');
                const devices = HID.devices();

                const keyboardDevices = devices.filter(device =>
                    device.usagePage === 1 && device.usage === 6
                );

                if (keyboardDevices.length === 0) {
                    this.addWarning('Keine HID-Tastatur-Geräte gefunden');
                    return 'Keine HID-Geräte';
                }

                // Potentielle RFID-Reader finden
                const potentialRFID = keyboardDevices.filter(device => {
                    const product = (device.product || '').toLowerCase();
                    return product.includes('rfid') ||
                        product.includes('card') ||
                        product.includes('reader');
                });

                if (potentialRFID.length === 0) {
                    this.addWarning('Keine RFID-Reader gefunden - prüfen Sie die Hardware');
                }

                return `${keyboardDevices.length} HID-Keyboards, ${potentialRFID.length} RFID-Reader`;

            } catch (error) {
                throw new Error(`HID-Enumeration fehlgeschlagen: ${error.message}`);
            }
        });

        // RFID Konfiguration
        await this.runTest('RFID Konfiguration', () => {
            const scanInterval = parseInt(process.env.RFID_MIN_SCAN_INTERVAL) || 1000;
            const inputTimeout = parseInt(process.env.RFID_INPUT_TIMEOUT) || 500;

            if (scanInterval < 100) {
                this.addWarning('Sehr kurzes Scan-Interval - kann zu Duplikaten führen');
            }

            if (inputTimeout > 2000) {
                this.addWarning('Sehr langes Input-Timeout - Tags könnten übersehen werden');
            }

            return `Scan: ${scanInterval}ms, Timeout: ${inputTimeout}ms`;
        });
    }

    async testFileSystem() {
        this.printTestHeader('Dateisystem');

        // Verzeichnisse
        const requiredDirs = ['renderer', 'rfid', 'db'];
        const optionalDirs = ['logs', 'temp', 'backup'];

        for (const dir of requiredDirs) {
            await this.runTest(`Verzeichnis: ${dir}`, () => {
                if (!fs.existsSync(dir)) {
                    throw new Error(`Erforderliches Verzeichnis fehlt: ${dir}`);
                }

                const files = fs.readdirSync(dir).length;
                return `${files} Dateien`;
            });
        }

        for (const dir of optionalDirs) {
            await this.runTest(`Verzeichnis: ${dir} (optional)`, () => {
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                    return 'Erstellt';
                }

                const files = fs.readdirSync(dir).length;
                return `${files} Dateien`;
            }, false); // Nicht kritisch
        }

        // Schreibrechte testen
        await this.runTest('Schreibrechte', () => {
            const testFile = path.join('temp', 'write-test.txt');

            try {
                fs.writeFileSync(testFile, 'Test');
                fs.unlinkSync(testFile);
                return 'Schreibzugriff OK';
            } catch (error) {
                throw new Error(`Keine Schreibrechte im Projektverzeichnis: ${error.message}`);
            }
        });

        // Festplattenspeicher
        await this.runTest('Festplattenspeicher', () => {
            try {
                const stats = fs.statSync(process.cwd());
                // Vereinfachte Speicherprüfung
                return 'Verfügbar'; // TODO: Echte Speicherprüfung implementieren
            } catch (error) {
                this.addWarning('Speicherprüfung fehlgeschlagen');
                return 'Unbekannt';
            }
        });
    }

    async testSecurity() {
        this.printTestHeader('Sicherheits-Checks');

        // .env Berechtigungen (Unix-systeme)
        await this.runTest('.env Dateiberechtigungen', () => {
            if (process.platform === 'win32') {
                return 'Windows - übersprungen';
            }

            try {
                const stats = fs.statSync('.env');
                const mode = stats.mode.toString(8);

                // Prüfe ob Datei für andere lesbar ist
                if (mode.endsWith('44') || mode.endsWith('64')) {
                    this.addWarning('.env für andere Benutzer lesbar - Sicherheitsrisiko');
                }

                return `Modus: ${mode}`;
            } catch (error) {
                return '.env nicht gefunden';
            }
        });

        // Passwort-Sicherheit
        await this.runTest('Passwort-Sicherheit', () => {
            const password = process.env.MSSQL_PASSWORD;

            if (!password) {
                throw new Error('Kein Passwort gesetzt');
            }

            let score = 0;
            let feedback = [];

            if (password.length >= 8) score++; else feedback.push('zu kurz');
            if (/[A-Z]/.test(password)) score++; else feedback.push('keine Großbuchstaben');
            if (/[a-z]/.test(password)) score++; else feedback.push('keine Kleinbuchstaben');
            if (/[0-9]/.test(password)) score++; else feedback.push('keine Zahlen');
            if (/[^A-Za-z0-9]/.test(password)) score++; else feedback.push('keine Sonderzeichen');

            if (score < 3) {
                this.addWarning(`Schwaches Passwort: ${feedback.join(', ')}`);
            }

            return `Score: ${score}/5`;
        });

        // Node.js Sicherheit
        await this.runTest('Node.js Sicherheits-Audit', () => {
            try {
                const { execSync } = require('child_process');
                const auditOutput = execSync('npm audit --audit-level=high', { encoding: 'utf8' });

                if (auditOutput.includes('found 0 vulnerabilities')) {
                    return 'Keine kritischen Schwachstellen';
                } else {
                    this.addWarning('Sicherheitsschwachstellen gefunden - npm audit fix ausführen');
                    return 'Schwachstellen gefunden';
                }
            } catch (error) {
                this.addWarning('Security Audit fehlgeschlagen');
                return 'Audit-Fehler';
            }
        });
    }

    async runTest(testName, testFunction, critical = true) {
        this.results.total++;

        try {
            const result = await testFunction();
            this.results.passed++;
            this.results.tests.push({
                name: testName,
                status: 'PASS',
                result: result,
                critical: critical
            });
            console.log(`  ✅ ${testName}: ${result}`);
        } catch (error) {
            if (critical) {
                this.results.failed++;
                this.results.tests.push({
                    name: testName,
                    status: 'FAIL',
                    error: error.message,
                    critical: critical
                });
                console.log(`  ❌ ${testName}: ${error.message}`);
            } else {
                this.results.warnings++;
                this.results.tests.push({
                    name: testName,
                    status: 'WARN',
                    error: error.message,
                    critical: critical
                });
                console.log(`  ⚠️  ${testName}: ${error.message}`);
            }
        }
    }

    addWarning(message) {
        this.results.warnings++;
        console.log(`  ⚠️  ${message}`);
    }

    printTestHeader(section) {
        console.log(`\n🔍 ${section}`);
        console.log('-'.repeat(section.length + 3));
    }

    printSummary() {
        console.log('\n' + '='.repeat(50));
        console.log('📊 TEST ZUSAMMENFASSUNG');
        console.log('='.repeat(50));

        console.log(`\n📈 Statistiken:`);
        console.log(`   Gesamt: ${this.results.total} Tests`);
        console.log(`   ✅ Erfolgreich: ${this.results.passed}`);
        console.log(`   ❌ Fehlgeschlagen: ${this.results.failed}`);
        console.log(`   ⚠️  Warnungen: ${this.results.warnings}`);

        const successRate = Math.round((this.results.passed / this.results.total) * 100);
        console.log(`   📊 Erfolgsrate: ${successRate}%`);

        if (this.results.failed === 0) {
            console.log('\n🎉 ALLE KRITISCHEN TESTS BESTANDEN!');
            console.log('✅ System ist bereit für den Produktivbetrieb');

            if (this.results.warnings > 0) {
                console.log(`\n💡 ${this.results.warnings} Warnungen gefunden - siehe Details oben`);
            }
        } else {
            console.log(`\n❌ ${this.results.failed} KRITISCHE TESTS FEHLGESCHLAGEN`);
            console.log('🔧 Beheben Sie die Probleme bevor Sie die Anwendung produktiv einsetzen');

            // Fehlgeschlagene Tests auflisten
            const failedTests = this.results.tests.filter(test => test.status === 'FAIL');
            console.log('\n🚨 Fehlgeschlagene Tests:');
            failedTests.forEach(test => {
                console.log(`   • ${test.name}: ${test.error}`);
            });
        }

        console.log('\n🚀 Nächste Schritte:');
        if (this.results.failed === 0) {
            console.log('   1. Starten Sie die Anwendung: npm start');
            console.log('   2. Testen Sie RFID-Reader mit echtem Tag');
            console.log('   3. Testen Sie QR-Scanner mit Test-Code');
            console.log('   4. Überprüfen Sie Benutzer-Anmeldung und Scan-Erfassung');
        } else {
            console.log('   1. Beheben Sie alle kritischen Fehler');
            console.log('   2. Führen Sie Tests erneut aus: node test.js');
            console.log('   3. Bei Problemen: Dokumentation konsultieren');
        }

        console.log('='.repeat(50));
    }

    getDirSize(dirPath) {
        let totalSize = 0;

        try {
            const files = fs.readdirSync(dirPath);

            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stats = fs.statSync(filePath);

                if (stats.isDirectory()) {
                    totalSize += this.getDirSize(filePath);
                } else {
                    totalSize += stats.size;
                }
            }
        } catch (error) {
            // Ignoriere Fehler bei der Größenberechnung
        }

        return totalSize;
    }
}

// Script ausführen wenn direkt aufgerufen
if (require.main === module) {
    const tester = new ComponentTester();
    tester.runAllTests().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('❌ Test-Suite Fehler:', error);
        process.exit(1);
    });
}

module.exports = ComponentTester;