-- Datenbank Schema für RFID Wareneinlagerung System
-- Microsoft SQL Server

-- Datenbank erstellen (falls nicht vorhanden)
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'WareneinlagerungDB')
BEGIN
    CREATE DATABASE WareneinlagerungDB;
END
GO

USE WareneinlagerungDB;
GO

-- Tabelle für Benutzer/Mitarbeiter
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ScannBenutzer' AND xtype='U')
BEGIN
CREATE TABLE ScannBenutzer (
                               ID int IDENTITY(1,1) PRIMARY KEY,
                               Name nvarchar(100) NOT NULL,
                               EPC nvarchar(50) NOT NULL UNIQUE, -- RFID-Tag ID (hex)
                               Email nvarchar(255) NULL,
                               Department nvarchar(100) NULL,
                               Active bit NOT NULL DEFAULT 1,
                               CreatedAt datetime2 NOT NULL DEFAULT GETDATE(),
                               UpdatedAt datetime2 NOT NULL DEFAULT GETDATE(),
                               LastLoginAt datetime2 NULL,

                               CONSTRAINT CK_ScannBenutzer_Name CHECK (LEN(TRIM(Name)) > 0),
                               CONSTRAINT CK_ScannBenutzer_EPC CHECK (LEN(TRIM(EPC)) >= 4)
);

-- Indizes für Performance
CREATE INDEX IX_ScannBenutzer_EPC ON ScannBenutzer(EPC);
CREATE INDEX IX_ScannBenutzer_Active ON ScannBenutzer(Active);
CREATE INDEX IX_ScannBenutzer_Department ON ScannBenutzer(Department);

PRINT 'Tabelle ScannBenutzer erstellt';
END
ELSE
BEGIN
    PRINT 'Tabelle ScannBenutzer existiert bereits';
END
GO

-- Tabelle für Sessions (Arbeitszeiten)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Sessions' AND xtype='U')
BEGIN
CREATE TABLE Sessions (
                          ID int IDENTITY(1,1) PRIMARY KEY,
                          UserID int NOT NULL,
                          StartTime datetime2 NOT NULL DEFAULT GETDATE(),
                          EndTime datetime2 NULL,
                          Active bit NOT NULL DEFAULT 1,
                          CreatedAt datetime2 NOT NULL DEFAULT GETDATE(),

                          CONSTRAINT FK_Sessions_UserID FOREIGN KEY (UserID) REFERENCES ScannBenutzer(ID),
                          CONSTRAINT CK_Sessions_Times CHECK (EndTime IS NULL OR EndTime >= StartTime)
);

-- Unique Index: Pro Benutzer nur eine aktive Session
CREATE UNIQUE INDEX IX_Sessions_User_Active
    ON Sessions(UserID, Active)
    WHERE Active = 1;

-- Weitere Indizes
CREATE INDEX IX_Sessions_StartTime ON Sessions(StartTime);
CREATE INDEX IX_Sessions_Active ON Sessions(Active);
CREATE INDEX IX_Sessions_UserID_StartTime ON Sessions(UserID, StartTime);

PRINT 'Tabelle Sessions erstellt';
END
ELSE
BEGIN
    PRINT 'Tabelle Sessions existiert bereits';
END
GO

-- Tabelle für QR-Code-Scans
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='QrScans' AND xtype='U')
BEGIN
CREATE TABLE QrScans (
                         ID int IDENTITY(1,1) PRIMARY KEY,
                         SessionID int NOT NULL,
                         QrCode nvarchar(MAX) NOT NULL,
                         ScanTime datetime2 NOT NULL DEFAULT GETDATE(),
                         JsonPayload nvarchar(MAX) NULL, -- Für JSON-QR-Codes
                         ProcessedAt datetime2 NULL,
                         ProcessingStatus nvarchar(50) NULL DEFAULT 'pending',

                         CONSTRAINT FK_QrScans_SessionID FOREIGN KEY (SessionID) REFERENCES Sessions(ID),
                         CONSTRAINT CK_QrScans_QrCode CHECK (LEN(TRIM(QrCode)) > 0)
);

-- Computed Column für JSON-Validation
ALTER TABLE QrScans ADD IsValidJson AS (
        CASE
            WHEN ISJSON(QrCode) = 1 THEN CAST(1 AS bit)
            ELSE CAST(0 AS bit)
        END
    );

-- Indizes für Performance
CREATE INDEX IX_QrScans_SessionID ON QrScans(SessionID);
CREATE INDEX IX_QrScans_ScanTime ON QrScans(ScanTime);
CREATE INDEX IX_QrScans_ProcessingStatus ON QrScans(ProcessingStatus);
CREATE INDEX IX_QrScans_Session_ScanTime ON QrScans(SessionID, ScanTime);

PRINT 'Tabelle QrScans erstellt';
END
ELSE
BEGIN
    PRINT 'Tabelle QrScans existiert bereits';
END
GO

-- Optional: Tabelle für Scan-Typen (für erweiterte Funktionalität)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ScannTyp' AND xtype='U')
BEGIN
CREATE TABLE ScannTyp (
                          ID int IDENTITY(1,1) PRIMARY KEY,
                          Name nvarchar(100) NOT NULL UNIQUE,
                          Description nvarchar(500) NULL,
                          Active bit NOT NULL DEFAULT 1,
                          CreatedAt datetime2 NOT NULL DEFAULT GETDATE()
);

-- Standard-Scan-Typen einfügen
INSERT INTO ScannTyp (Name, Description) VALUES
                                             ('Wareneinlagerung', 'Eingehende Pakete und Lieferungen'),
                                             ('Wareneinlagerung', 'Einlagerung in Lagerplätze'),
                                             ('Qualitätsprüfung', 'Qualitätskontrolle der Waren'),
                                             ('Kommissionierung', 'Entnahme für Bestellungen'),
                                             ('Inventur', 'Bestandsaufnahme und Kontrolle');

PRINT 'Tabelle ScannTyp erstellt und mit Standardwerten gefüllt';
END
GO

-- Views für häufige Abfragen
-- View: Aktive Sessions mit Benutzerinformationen
IF NOT EXISTS (SELECT * FROM sys.views WHERE name = 'ActiveSessionsView')
BEGIN
EXEC('
    CREATE VIEW ActiveSessionsView AS
    SELECT
        s.ID as SessionID,
        s.UserID,
        u.Name as UserName,
        u.Department,
        s.StartTime,
        DATEDIFF(SECOND, s.StartTime, GETDATE()) as DurationSeconds,
        COUNT(qr.ID) as ScanCount,
        MAX(qr.ScanTime) as LastScanTime
    FROM Sessions s
    INNER JOIN ScannBenutzer u ON s.UserID = u.ID
    LEFT JOIN QrScans qr ON s.ID = qr.SessionID
    WHERE s.Active = 1
    GROUP BY s.ID, s.UserID, u.Name, u.Department, s.StartTime
    ');

    PRINT 'View ActiveSessionsView erstellt';
END
GO

-- View: Session-Statistiken
IF NOT EXISTS (SELECT * FROM sys.views WHERE name = 'SessionStatsView')
BEGIN
EXEC('
    CREATE VIEW SessionStatsView AS
    SELECT
        s.ID as SessionID,
        s.UserID,
        u.Name as UserName,
        u.Department,
        s.StartTime,
        s.EndTime,
        s.Active,
        DATEDIFF(SECOND, s.StartTime, ISNULL(s.EndTime, GETDATE())) as DurationSeconds,
        COUNT(qr.ID) as TotalScans,
        MIN(qr.ScanTime) as FirstScanTime,
        MAX(qr.ScanTime) as LastScanTime,
        AVG(CAST(DATEDIFF(SECOND, LAG(qr.ScanTime) OVER (PARTITION BY s.ID ORDER BY qr.ScanTime), qr.ScanTime) AS FLOAT)) as AvgScanInterval
    FROM Sessions s
    INNER JOIN ScannBenutzer u ON s.UserID = u.ID
    LEFT JOIN QrScans qr ON s.ID = qr.SessionID
    GROUP BY s.ID, s.UserID, u.Name, u.Department, s.StartTime, s.EndTime, s.Active
    ');

    PRINT 'View SessionStatsView erstellt';
END
GO

-- Stored Procedures für häufige Operationen
-- Procedure: Benutzer Login
IF NOT EXISTS (SELECT * FROM sys.procedures WHERE name = 'sp_UserLogin')
BEGIN
EXEC('
    CREATE PROCEDURE sp_UserLogin
        @TagId NVARCHAR(50),
        @SessionId INT OUTPUT,
        @UserName NVARCHAR(100) OUTPUT,
        @IsNewSession BIT OUTPUT
    AS
    BEGIN
        SET NOCOUNT ON;

        DECLARE @UserId INT;

        -- Benutzer finden
        SELECT @UserId = ID, @UserName = Name
        FROM ScannBenutzer
        WHERE EPC = @TagId AND Active = 1;

        IF @UserId IS NULL
        BEGIN
            RAISERROR(''Unbekannter RFID-Tag'', 16, 1);
            RETURN;
        END

        -- Prüfen ob bereits aktive Session existiert
        SELECT @SessionId = ID
        FROM Sessions
        WHERE UserID = @UserId AND Active = 1;

        IF @SessionId IS NOT NULL
        BEGIN
            -- Session neu starten (Timer zurücksetzen)
            UPDATE Sessions
            SET StartTime = GETDATE()
            WHERE ID = @SessionId;

            SET @IsNewSession = 0;
        END
        ELSE
        BEGIN
            -- Neue Session erstellen
            INSERT INTO Sessions (UserID, StartTime, Active)
            VALUES (@UserId, GETDATE(), 1);

            SET @SessionId = SCOPE_IDENTITY();
            SET @IsNewSession = 1;
        END

        -- Letzten Login aktualisieren
        UPDATE ScannBenutzer
        SET LastLoginAt = GETDATE()
        WHERE ID = @UserId;
    END
    ');

    PRINT 'Stored Procedure sp_UserLogin erstellt';
END
GO

-- Trigger für UpdatedAt-Spalten
IF NOT EXISTS (SELECT * FROM sys.triggers WHERE name = 'tr_ScannBenutzer_UpdatedAt')
BEGIN
EXEC('
    CREATE TRIGGER tr_ScannBenutzer_UpdatedAt
    ON ScannBenutzer
    AFTER UPDATE
    AS
    BEGIN
        SET NOCOUNT ON;

        UPDATE ScannBenutzer
        SET UpdatedAt = GETDATE()
        FROM ScannBenutzer sb
        INNER JOIN inserted i ON sb.ID = i.ID;
    END
    ');

    PRINT 'Trigger tr_ScannBenutzer_UpdatedAt erstellt';
END
GO

-- Beispiel-Daten einfügen (nur für Entwicklung/Tests)
IF NOT EXISTS (SELECT * FROM ScannBenutzer WHERE EPC = '12345678')
BEGIN
INSERT INTO ScannBenutzer (Name, EPC, Email, Department) VALUES
                                                             ('Max Mustermann', '12345678', 'max.mustermann@firma.de', 'Lager'),
                                                             ('Anna Schmidt', 'ABCDEF01', 'anna.schmidt@firma.de', 'Lager'),
                                                             ('Tom Weber', '87654321', 'tom.weber@firma.de', 'Qualität'),
                                                             ('Lisa König', 'FEDCBA09', 'lisa.koenig@firma.de', 'Lager'),
                                                             ('Peter Müller', '11223344', 'peter.mueller@firma.de', 'Versand');

PRINT 'Beispiel-Benutzer erstellt';
END
GO

-- Berechtigungen setzen (optional)
-- Benutzer für die Anwendung erstellen
IF NOT EXISTS (SELECT * FROM sys.server_principals WHERE name = 'WareneinlagerungUser')
BEGIN
    CREATE LOGIN WareneinlagerungUser WITH PASSWORD = 'SecurePassword123!';
    PRINT 'Login WareneinlagerungUser erstellt';
END

IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = 'WareneinlagerungUser')
BEGIN
    CREATE USER WareneinlagerungUser FOR LOGIN WareneinlagerungUser;

    -- Berechtigungen zuweisen
    ALTER ROLE db_datareader ADD MEMBER WareneinlagerungUser;
    ALTER ROLE db_datawriter ADD MEMBER WareneinlagerungUser;

    -- Spezifische Berechtigungen für Stored Procedures
GRANT EXECUTE ON sp_UserLogin TO WareneinlagerungUser;

PRINT 'Datenbankbenutzer WareneinlagerungUser erstellt und konfiguriert';
END
GO

-- Wartungsaufgaben
-- Index-Wartung
CREATE OR ALTER PROCEDURE sp_MaintenanceRebuildIndexes
    AS
BEGIN
    DECLARE @sql NVARCHAR(MAX) = '';

SELECT @sql = @sql + 'ALTER INDEX ALL ON ' + SCHEMA_NAME(schema_id) + '.' + name + ' REBUILD;' + CHAR(13)
FROM sys.tables
WHERE name IN ('ScannBenutzer', 'Sessions', 'QrScans', 'ScannTyp');

EXEC sp_executesql @sql;
    PRINT 'Indizes wurden neu erstellt';
END
GO

-- Statistiken aktualisieren
CREATE OR ALTER PROCEDURE sp_MaintenanceUpdateStats
    AS
BEGIN
UPDATE STATISTICS ScannBenutzer;
UPDATE STATISTICS Sessions;
UPDATE STATISTICS QrScans;
UPDATE STATISTICS ScannTyp;
PRINT 'Statistiken wurden aktualisiert';
END
GO

PRINT 'Datenbank-Schema erfolgreich erstellt/aktualisiert';
PRINT 'Wareneinlagerung System bereit für den Einsatz';
GO