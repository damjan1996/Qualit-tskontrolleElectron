# ===================================================================
# Qualitätskontrolle Schema Installation (PowerShell)
# ===================================================================

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "   QC Schema Installation" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Prüfe ob Node.js verfügbar ist
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js gefunden: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ FEHLER: Node.js ist nicht installiert oder nicht im PATH!" -ForegroundColor Red
    Write-Host "Bitte installieren Sie Node.js von https://nodejs.org/" -ForegroundColor Yellow
    Read-Host "Drücken Sie Enter zum Beenden"
    exit 1
}

Write-Host ""
Write-Host "🔧 1. Automatische Installation über Node.js Script..." -ForegroundColor Yellow
Write-Host ""

# Führe Node.js Script aus
try {
    $result = & node scripts/install-qc-schema.js
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✅ Automatische Installation erfolgreich!" -ForegroundColor Green
        $autoInstallSuccess = $true
    } else {
        throw "Node.js Script fehlgeschlagen"
    }
} catch {
    Write-Host ""
    Write-Host "⚠️ Automatische Installation fehlgeschlagen!" -ForegroundColor Yellow
    Write-Host "Versuche manuelle SQL-Installation..." -ForegroundColor Yellow
    Write-Host ""
    $autoInstallSuccess = $false
}

if (-not $autoInstallSuccess) {
    # Lade .env Datei
    $envVars = @{}
    if (Test-Path ".env") {
        Get-Content ".env" | ForEach-Object {
            if ($_ -match "^([^=]+)=(.*)$") {
                $envVars[$matches[1]] = $matches[2]
            }
        }

        Write-Host "📊 Datenbankverbindung:" -ForegroundColor Cyan
        Write-Host "   Server: $($envVars['MSSQL_SERVER'])" -ForegroundColor Gray
        Write-Host "   Database: $($envVars['MSSQL_DATABASE'])" -ForegroundColor Gray
        Write-Host "   User: $($envVars['MSSQL_USER'])" -ForegroundColor Gray
        Write-Host ""
    } else {
        Write-Host "⚠️ .env Datei nicht gefunden!" -ForegroundColor Yellow
    }

    # Prüfe ob sqlcmd verfügbar ist
    try {
        $null = & sqlcmd -?
        Write-Host "✅ sqlcmd gefunden" -ForegroundColor Green

        # Führe SQL-Schema aus
        Write-Host "🚀 Führe SQL-Schema aus..." -ForegroundColor Yellow

        $sqlCmd = "sqlcmd -S `"$($envVars['MSSQL_SERVER'])`" -d `"$($envVars['MSSQL_DATABASE'])`" -U `"$($envVars['MSSQL_USER'])`" -P `"$($envVars['MSSQL_PASSWORD'])`" -i sql/quality-control-schema.sql"

        try {
            Invoke-Expression $sqlCmd
            if ($LASTEXITCODE -eq 0) {
                Write-Host ""
                Write-Host "✅ Schema erfolgreich installiert!" -ForegroundColor Green
                $sqlInstallSuccess = $true
            } else {
                throw "sqlcmd fehlgeschlagen"
            }
        } catch {
            Write-Host ""
            Write-Host "❌ FEHLER: Manuelle SQL-Installation fehlgeschlagen!" -ForegroundColor Red
            Write-Host ""
            Write-Host "🔧 Lösungsvorschläge:" -ForegroundColor Yellow
            Write-Host "1. Überprüfen Sie die Datenbankverbindung in .env" -ForegroundColor Gray
            Write-Host "2. Stellen Sie sicher, dass der Benutzer CREATE-Rechte hat" -ForegroundColor Gray
            Write-Host "3. Verwenden Sie SQL Server Management Studio (SSMS):" -ForegroundColor Gray
            Write-Host "   - Öffnen Sie sql/quality-control-schema.sql" -ForegroundColor Gray
            Write-Host "   - Führen Sie das komplette Script aus (F5)" -ForegroundColor Gray
            Write-Host "4. Kontaktieren Sie den Support" -ForegroundColor Gray
            $sqlInstallSuccess = $false
        }

    } catch {
        Write-Host "⚠️ sqlcmd ist nicht verfügbar!" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "🔧 Manuelle Installation erforderlich:" -ForegroundColor Yellow
        Write-Host "1. Öffnen Sie SQL Server Management Studio (SSMS)" -ForegroundColor Gray
        Write-Host "2. Verbinden Sie sich mit der Datenbank" -ForegroundColor Gray
        Write-Host "3. Öffnen Sie sql/quality-control-schema.sql" -ForegroundColor Gray
        Write-Host "4. Führen Sie das komplette Script aus (F5)" -ForegroundColor Gray
        $sqlInstallSuccess = $false
    }
}

Write-Host ""

if ($autoInstallSuccess -or $sqlInstallSuccess) {
    Write-Host "🎉========================================" -ForegroundColor Green
    Write-Host "   Installation erfolgreich abgeschlossen!" -ForegroundColor Green
    Write-Host "========================================🎉" -ForegroundColor Green
    Write-Host ""
    Write-Host "🚀 Nächste Schritte:" -ForegroundColor Cyan
    Write-Host "1. Starten Sie die Anwendung: npm start" -ForegroundColor Gray
    Write-Host "2. Loggen Sie sich mit RFID-Tags ein" -ForegroundColor Gray
    Write-Host "3. Beginnen Sie mit der Qualitätskontrolle!" -ForegroundColor Gray
    Write-Host ""
    Write-Host "🔍 QC-Workflow:" -ForegroundColor Cyan
    Write-Host "• Mitarbeiter auswählen in der Sidebar" -ForegroundColor Gray
    Write-Host "• QR-Code scannen → Eingang (QC startet)" -ForegroundColor Gray
    Write-Host "• Gleichen QR-Code nochmal scannen → Ausgang (QC abgeschlossen)" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host "❌========================================" -ForegroundColor Red
    Write-Host "   Installation fehlgeschlagen!" -ForegroundColor Red
    Write-Host "========================================❌" -ForegroundColor Red
    Write-Host ""
    Write-Host "📞 Support benötigt:" -ForegroundColor Yellow
    Write-Host "1. Überprüfen Sie die Datenbankverbindung" -ForegroundColor Gray
    Write-Host "2. Führen Sie sql/quality-control-schema.sql manuell in SSMS aus" -ForegroundColor Gray
    Write-Host "3. Kontaktieren Sie den Support mit den Fehlermeldungen" -ForegroundColor Gray
    Write-Host ""
}

Write-Host "💡 Die Anwendung läuft auch ohne QC-Schema im Simulation-Modus." -ForegroundColor Blue
Write-Host ""

Read-Host "Drücken Sie Enter zum Beenden"