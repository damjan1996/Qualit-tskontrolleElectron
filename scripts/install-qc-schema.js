/**
 * Qualitätskontrolle Schema Installer
 * Automatische Installation des QC-Datenbankschemas
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Database Client laden
const DatabaseClient = require('../db/db-client');

class QCSchemaInstaller {
    constructor() {
        this.dbClient = null;
        this.schemaPath = path.join(__dirname, '..', 'sql', 'quality-control-schema.sql');
    }

    async install() {
        console.log('🔧 Qualitätskontrolle Schema Installation startet...\n');

        try {
            // 1. Datenbankverbindung herstellen
            console.log('📊 Verbinde mit Datenbank...');
            this.dbClient = new DatabaseClient();
            const connected = await this.dbClient.connect();

            if (!connected) {
                throw new Error('Datenbankverbindung fehlgeschlagen');
            }
            console.log('✅ Datenbankverbindung erfolgreich\n');

            // 2. Prüfe ob QC-Tabellen bereits existieren
            console.log('🔍 Überprüfe vorhandene QC-Tabellen...');
            const tablesExist = await this.checkQCTablesExist();

            if (tablesExist.allExist) {
                console.log('✅ Alle QC-Tabellen bereits vorhanden:');
                tablesExist.existing.forEach(table => console.log(`   ✓ ${table}`));
                console.log('\n📋 Schema bereits installiert - keine Aktion erforderlich');
                return true;
            } else {
                console.log('⚠️ Fehlende QC-Tabellen gefunden:');
                tablesExist.missing.forEach(table => console.log(`   ❌ ${table}`));
                console.log('');
            }

            // 3. Schema-Datei lesen
            console.log('📄 Lade QC-Schema-Datei...');
            if (!fs.existsSync(this.schemaPath)) {
                throw new Error(`Schema-Datei nicht gefunden: ${this.schemaPath}`);
            }

            const schemaSQL = fs.readFileSync(this.schemaPath, 'utf8');
            console.log(`✅ Schema-Datei geladen (${schemaSQL.length} Zeichen)\n`);

            // 4. Schema installieren
            console.log('🚀 Installiere QC-Schema...');
            await this.executeSchemaSQL(schemaSQL);

            // 5. Installation verifizieren
            console.log('✅ Schema-Installation abgeschlossen\n');
            console.log('🔍 Verifiziere Installation...');

            const verificationResult = await this.verifyInstallation();
            if (verificationResult.success) {
                console.log('✅ Installation erfolgreich verifiziert\n');
                console.log('📊 Installierte Objekte:');
                verificationResult.objects.forEach(obj => {
                    console.log(`   ✓ ${obj.type}: ${obj.name}`);
                });
            } else {
                console.warn('⚠️ Verifikation teilweise fehlgeschlagen:', verificationResult.warnings);
            }

            console.log('\n🎉 Qualitätskontrolle Schema erfolgreich installiert!');
            console.log('💡 Die Anwendung kann jetzt mit QC-Funktionalität gestartet werden.');

            return true;

        } catch (error) {
            console.error('\n❌ Schema-Installation fehlgeschlagen:', error.message);
            console.error('\n🔧 Lösungsvorschläge:');
            console.error('   1. Überprüfen Sie die Datenbankverbindung in .env');
            console.error('   2. Stellen Sie sicher, dass der Benutzer CREATE-Rechte hat');
            console.error('   3. Führen Sie das Schema manuell aus:');
            console.error(`      sqlcmd -S ${process.env.MSSQL_SERVER} -d ${process.env.MSSQL_DATABASE} -i sql/quality-control-schema.sql`);
            return false;

        } finally {
            if (this.dbClient) {
                await this.dbClient.close();
            }
        }
    }

    async checkQCTablesExist() {
        const requiredTables = [
            'QualityControlSteps',
            'QualityControlAudit',
            'QualityControlConfig'
        ];

        const existing = [];
        const missing = [];

        for (const tableName of requiredTables) {
            try {
                const result = await this.dbClient.query(`
                    SELECT COUNT(*) as TableExists
                    FROM INFORMATION_SCHEMA.TABLES 
                    WHERE TABLE_NAME = ? AND TABLE_SCHEMA = 'dbo'
                `, [tableName]);

                if (result.recordset[0].TableExists > 0) {
                    existing.push(tableName);
                } else {
                    missing.push(tableName);
                }
            } catch (error) {
                missing.push(tableName);
            }
        }

        return {
            allExist: missing.length === 0,
            existing: existing,
            missing: missing,
            requiredCount: requiredTables.length,
            existingCount: existing.length
        };
    }

    async executeSchemaSQL(schemaSQL) {
        try {
            // SQL in einzelne Statements aufteilen (GO-separated)
            const statements = schemaSQL
                .split(/\r?\nGO\r?\n/i)
                .map(stmt => stmt.trim())
                .filter(stmt => stmt.length > 0 && !stmt.match(/^--/));

            console.log(`📝 Führe ${statements.length} SQL-Statements aus...`);

            let successCount = 0;
            let errorCount = 0;

            for (let i = 0; i < statements.length; i++) {
                const statement = statements[i];

                // Skip pure comments
                if (statement.startsWith('--') || statement.startsWith('/*')) {
                    continue;
                }

                try {
                    await this.dbClient.query(statement);
                    successCount++;

                    // Progress indicator
                    if ((i + 1) % 5 === 0 || i === statements.length - 1) {
                        console.log(`   📊 Fortschritt: ${i + 1}/${statements.length} (${successCount} erfolgreich, ${errorCount} Fehler)`);
                    }

                } catch (error) {
                    errorCount++;

                    // Behandle bekannte nicht-kritische Fehler
                    if (this.isNonCriticalError(error)) {
                        console.warn(`   ⚠️ Warnung bei Statement ${i + 1}: ${error.message}`);
                    } else {
                        console.error(`   ❌ Fehler bei Statement ${i + 1}: ${error.message}`);
                        console.error(`   SQL: ${statement.substring(0, 100)}...`);

                        // Bei kritischen Fehlern stoppen
                        if (this.isCriticalError(error)) {
                            throw error;
                        }
                    }
                }
            }

            console.log(`✅ Schema-Ausführung abgeschlossen: ${successCount} erfolgreich, ${errorCount} Fehler/Warnungen`);

        } catch (error) {
            console.error('Fehler beim Ausführen des Schemas:', error);
            throw error;
        }
    }

    isNonCriticalError(error) {
        const nonCriticalPatterns = [
            'already exists',
            'bereits vorhanden',
            'cannot drop the index',
            'cannot drop the view',
            'duplicate key',
            'already granted'
        ];

        return nonCriticalPatterns.some(pattern =>
            error.message.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    isCriticalError(error) {
        const criticalPatterns = [
            'access denied',
            'permission denied',
            'login failed',
            'cannot open database',
            'syntax error',
            'invalid object name' // Aber nur bei CREATE-Statements
        ];

        return criticalPatterns.some(pattern =>
            error.message.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    async verifyInstallation() {
        try {
            const verificationResults = {
                success: true,
                objects: [],
                warnings: []
            };

            // 1. Tabellen prüfen
            const tables = ['QualityControlSteps', 'QualityControlAudit', 'QualityControlConfig'];
            for (const tableName of tables) {
                try {
                    const result = await this.dbClient.query(`
                        SELECT COUNT(*) as Exists 
                        FROM INFORMATION_SCHEMA.TABLES 
                        WHERE TABLE_NAME = ?
                    `, [tableName]);

                    if (result.recordset[0].Exists > 0) {
                        verificationResults.objects.push({ type: 'Tabelle', name: tableName });
                    } else {
                        verificationResults.warnings.push(`Tabelle ${tableName} nicht gefunden`);
                    }
                } catch (error) {
                    verificationResults.warnings.push(`Fehler beim Prüfen von Tabelle ${tableName}: ${error.message}`);
                }
            }

            // 2. Views prüfen
            const views = ['vw_QCStepsWithSession', 'vw_DailyQCStats', 'vw_QCPerformanceOverview'];
            for (const viewName of views) {
                try {
                    const result = await this.dbClient.query(`
                        SELECT COUNT(*) as Exists 
                        FROM INFORMATION_SCHEMA.VIEWS 
                        WHERE TABLE_NAME = ?
                    `, [viewName]);

                    if (result.recordset[0].Exists > 0) {
                        verificationResults.objects.push({ type: 'View', name: viewName });
                    } else {
                        verificationResults.warnings.push(`View ${viewName} nicht gefunden`);
                    }
                } catch (error) {
                    verificationResults.warnings.push(`Fehler beim Prüfen von View ${viewName}: ${error.message}`);
                }
            }

            // 3. Stored Procedures prüfen
            const procedures = ['sp_StartQCStep', 'sp_CompleteQCStep', 'sp_AbortActiveQCSteps'];
            for (const procName of procedures) {
                try {
                    const result = await this.dbClient.query(`
                        SELECT COUNT(*) as Exists 
                        FROM INFORMATION_SCHEMA.ROUTINES 
                        WHERE ROUTINE_NAME = ? AND ROUTINE_TYPE = 'PROCEDURE'
                    `, [procName]);

                    if (result.recordset[0].Exists > 0) {
                        verificationResults.objects.push({ type: 'Procedure', name: procName });
                    } else {
                        verificationResults.warnings.push(`Procedure ${procName} nicht gefunden`);
                    }
                } catch (error) {
                    verificationResults.warnings.push(`Fehler beim Prüfen von Procedure ${procName}: ${error.message}`);
                }
            }

            // 4. Basis-Funktionalitätstest
            try {
                // Test: QualityControlSteps Tabelle beschreiben
                await this.dbClient.query('SELECT TOP 1 * FROM QualityControlSteps WHERE 1=0');
                verificationResults.objects.push({ type: 'Test', name: 'QualityControlSteps Grundfunktion' });
            } catch (error) {
                verificationResults.warnings.push(`Funktionstest fehlgeschlagen: ${error.message}`);
                verificationResults.success = false;
            }

            return verificationResults;

        } catch (error) {
            return {
                success: false,
                objects: [],
                warnings: [`Verifikation fehlgeschlagen: ${error.message}`]
            };
        }
    }

    async installDefaultConfiguration() {
        try {
            console.log('⚙️ Installiere Standard-QC-Konfiguration...');

            // Standard-Konfiguration für Qualitätskontrolle
            const result = await this.dbClient.query(`
                IF NOT EXISTS (SELECT * FROM QualityControlConfig WHERE SessionTypeName = 'Qualitätskontrolle')
                BEGIN
                    INSERT INTO QualityControlConfig (
                        SessionTypeName, RequiresBothScans, AllowParallelSteps, MaxParallelSteps,
                        DefaultPriority, AutoTimeoutMinutes, RequireQualityRating, RequireDefectCheck,
                        AllowRework, NotifyOnLongDuration, LongDurationThresholdMinutes, NotifyOnDefects
                    ) VALUES (
                        'Qualitätskontrolle', 1, 1, 10, 1, 120, 0, 1, 1, 1, 30, 1
                    );
                    SELECT 1 as Inserted;
                END
                ELSE
                    SELECT 0 as Inserted;
            `);

            if (result.recordset[0]?.Inserted) {
                console.log('✅ Standard-QC-Konfiguration installiert');
            } else {
                console.log('ℹ️ Standard-QC-Konfiguration bereits vorhanden');
            }

        } catch (error) {
            console.warn('⚠️ Warnung: Standard-Konfiguration konnte nicht installiert werden:', error.message);
        }
    }
}

// CLI Interface
async function main() {
    const installer = new QCSchemaInstaller();

    console.log('=====================================');
    console.log('  Qualitätskontrolle Schema Installer');
    console.log('=====================================\n');

    const success = await installer.install();

    if (success) {
        console.log('\n🎯 Nächste Schritte:');
        console.log('   1. Starten Sie die Anwendung: npm start');
        console.log('   2. Loggen Sie sich mit RFID-Tags ein');
        console.log('   3. Beginnen Sie mit der Qualitätskontrolle!\n');
        process.exit(0);
    } else {
        console.log('\n💡 Bei Problemen:');
        console.log('   1. Überprüfen Sie .env Datenbankeinstellungen');
        console.log('   2. Führen Sie sql/quality-control-schema.sql manuell aus');
        console.log('   3. Kontaktieren Sie den Support\n');
        process.exit(1);
    }
}

// Automatisches Schema-Check und Installation
async function autoInstallIfNeeded() {
    const installer = new QCSchemaInstaller();

    try {
        console.log('🔍 Automatische QC-Schema-Überprüfung...');

        // Quick check ohne vollständige Installation
        installer.dbClient = new DatabaseClient();
        const connected = await installer.dbClient.connect();

        if (!connected) {
            console.warn('⚠️ Datenbank nicht verfügbar - QC-Schema-Check übersprungen');
            return false;
        }

        const tablesExist = await installer.checkQCTablesExist();

        if (!tablesExist.allExist) {
            console.log(`⚠️ QC-Tabellen unvollständig (${tablesExist.existingCount}/${tablesExist.requiredCount})`);
            console.log('🚀 Starte automatische Schema-Installation...');

            const success = await installer.install();
            return success;
        } else {
            console.log('✅ QC-Schema vollständig vorhanden');
            return true;
        }

    } catch (error) {
        console.warn('⚠️ Automatische Schema-Überprüfung fehlgeschlagen:', error.message);
        return false;
    } finally {
        if (installer.dbClient) {
            await installer.dbClient.close();
        }
    }
}

// Export für andere Module
module.exports = {
    QCSchemaInstaller,
    autoInstallIfNeeded
};

// CLI Ausführung
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Unerwarteter Fehler:', error);
        process.exit(1);
    });
}