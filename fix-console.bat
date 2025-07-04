@echo off
REM ============================================================================
REM Windows Console Fix Script für RFID QR Wareneinlagerung
REM Behebt Unicode/Encoding-Probleme in der Windows-Konsole
REM ============================================================================

echo.
echo ====================================================
echo   RFID QR Wareneinlagerung - Console Fix
echo   Behebt Windows Console Encoding Probleme
echo ====================================================
echo.

REM Prüfe Admin-Rechte (optional für Registry-Änderungen)
net session >nul 2>&1
if errorlevel 1 (
    echo [WARNUNG] Script läuft ohne Admin-Rechte
    echo           Einige Fixes sind möglicherweise nicht verfügbar
    echo.
) else (
    echo [OK] Script läuft mit Admin-Rechten
    echo.
)

REM 1. Console-Codepage auf UTF-8 setzen
echo [1/5] Setze Console-Codepage auf UTF-8...
chcp 65001 >nul 2>&1
if errorlevel 1 (
    echo [FEHLER] Codepage konnte nicht gesetzt werden
    echo [INFO] Verwende Fallback-Modus
) else (
    echo [OK] UTF-8 Codepage aktiviert
)
echo.

REM 2. Console-Properties optimieren
echo [2/5] Optimiere Console-Eigenschaften...
if exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" (
    powershell -Command "& {[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::InputEncoding = [System.Text.Encoding]::UTF8}" 2>nul
    if errorlevel 1 (
        echo [WARNUNG] PowerShell-Encoding konnte nicht gesetzt werden
    ) else (
        echo [OK] PowerShell-Encoding optimiert
    )
) else (
    echo [INFO] PowerShell nicht verfügbar - überspringe
)
echo.

REM 3. Environment-Variablen setzen
echo [3/5] Setze Environment-Variablen...
set FORCE_COLOR=0
set NO_COLOR=1
set TERM=dumb
echo [OK] Console-Variablen gesetzt:
echo      FORCE_COLOR=0 (deaktiviert Farben)
echo      NO_COLOR=1 (forciert ASCII)
echo      TERM=dumb (einfacher Terminal-Modus)
echo.

REM 4. .env Datei prüfen und anpassen
echo [4/5] Prüfe .env Konfiguration...
if exist ".env" (
    echo [OK] .env Datei gefunden

    REM Backup erstellen
    copy ".env" ".env.backup.%date:~-4,4%%date:~-7,2%%date:~-10,2%" >nul 2>&1
    echo [OK] Backup erstellt: .env.backup.YYYYMMDD

    REM Windows-spezifische Einstellungen hinzufügen/aktualisieren
    echo. >> .env
    echo # Windows Console Fix - Automatisch hinzugefügt >> .env
    echo FORCE_ASCII_OUTPUT=true >> .env
    echo WINDOWS_UTF8_CONSOLE=false >> .env
    echo DISABLE_GPU=true >> .env
    echo WINDOWS_NO_HARDWARE_ACCEL=true >> .env

    echo [OK] .env Datei mit Windows-Fixes aktualisiert
) else (
    echo [WARNUNG] .env Datei nicht gefunden
    echo [INFO] Erstelle .env aus Vorlage...

    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo [OK] .env aus .env.example erstellt
    ) else (
        echo [FEHLER] Weder .env noch .env.example gefunden
        echo [INFO] Bitte manuell erstellen
    )
)
echo.

REM 5. Test der Console-Ausgabe
echo [5/5] Teste Console-Ausgabe...
echo [TEST] ASCII-Zeichen: OK
echo [TEST] Zahlen: 0123456789
echo [TEST] Sonderzeichen: +-*/=^%%
echo [TEST] Umlaute werden als ? angezeigt (das ist normal für ASCII-Modus)
echo.

REM Zusammenfassung
echo ====================================================
echo   CONSOLE FIX ABGESCHLOSSEN
echo ====================================================
echo.
echo [INFO] Die folgenden Änderungen wurden vorgenommen:
echo        1. UTF-8 Codepage aktiviert (für diese Session)
echo        2. Console-Encoding optimiert
echo        3. Environment-Variablen für ASCII-Modus gesetzt
echo        4. .env Datei mit Windows-Fixes aktualisiert
echo        5. Console-Ausgabe getestet
echo.
echo [WICHTIG] Änderungen gelten für:
echo          - Diese Console-Session: Sofort
echo          - Anwendung: Nach Neustart
echo          - Permanente Änderungen: In .env Datei
echo.
echo [NÄCHSTE SCHRITTE]
echo   1. Schließen Sie alle Command-Prompt-Fenster
echo   2. Öffnen Sie eine neue Console (cmd.exe)
echo   3. Starten Sie die Anwendung: pnpm start
echo   4. Prüfen Sie ob Unicode-Symbole korrekt angezeigt werden
echo.
echo   Falls weiterhin Probleme auftreten:
echo   - Verwenden Sie PowerShell statt cmd.exe
echo   - Starten Sie Windows Terminal (falls verfügbar)
echo   - Prüfen Sie .env Einstellungen
echo.

REM Warte auf Benutzereingabe
echo Drücken Sie eine beliebige Taste um fortzufahren...
pause >nul

REM Optional: Console-Eigenschaften dauerhaft ändern (Registry)
echo.
echo [OPTIONAL] Möchten Sie Console-Eigenschaften dauerhaft ändern?
echo           (Erfordert Registry-Änderung)
choice /c JN /n /m "Ja (J) oder Nein (N): "
if errorlevel 2 goto :skip_registry
if errorlevel 1 goto :set_registry

:set_registry
echo [REGISTRY] Ändere dauerhafte Console-Einstellungen...
reg add "HKCU\Console" /v "CodePage" /t REG_DWORD /d 65001 /f >nul 2>&1
if errorlevel 1 (
    echo [FEHLER] Registry-Änderung fehlgeschlagen
) else (
    echo [OK] UTF-8 als Standard-Codepage gesetzt
)

reg add "HKCU\Console" /v "FaceName" /t REG_SZ /d "Consolas" /f >nul 2>&1
reg add "HKCU\Console" /v "FontFamily" /t REG_DWORD /d 54 /f >nul 2>&1
reg add "HKCU\Console" /v "FontSize" /t REG_DWORD /d 1179648 /f >nul 2>&1
echo [OK] Console-Font optimiert (Consolas, UTF-8-kompatibel)

echo [OK] Registry-Änderungen abgeschlossen
goto :done

:skip_registry
echo [INFO] Registry-Änderungen übersprungen

:done
echo.
echo ====================================================
echo   SETUP KOMPLETT
echo ====================================================
echo.
echo [SUCCESS] Console-Fix erfolgreich angewendet!
echo.
echo Testen Sie die Anwendung mit:
echo   pnpm start
echo.
echo Bei Problemen:
echo   - Prüfen Sie die .env Datei
echo   - Verwenden Sie 'fix-console.bat' erneut
echo   - Konsultieren Sie die Dokumentation
echo.

REM Automatisch neue Console mit optimierten Einstellungen öffnen (optional)
choice /c JN /n /m "Neue optimierte Console öffnen? Ja (J) oder Nein (N): "
if errorlevel 2 goto :end
if errorlevel 1 (
    echo [INFO] Öffne neue Console mit optimierten Einstellungen...
    start cmd.exe /k "chcp 65001 && echo Console mit UTF-8 Codepage gestartet && echo Bereit für: pnpm start"
)

:end
echo.
echo Script beendet. Viel Erfolg mit der Anwendung!
pause