-- ===================================================================
-- Qualitätskontrolle Datenbankschema
-- Erweitert das bestehende Wareneinlagerung-Schema um QC-spezifische Tabellen
-- ===================================================================

USE [RdScanner];
GO

-- ===== QUALITÄTSKONTROLLE HAUPTTABELLE =====

-- Erweiterte QualityControlSteps Tabelle mit vollständiger QC-Funktionalität
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'QualityControlSteps')
BEGIN
CREATE TABLE dbo.QualityControlSteps (
                                         ID INT IDENTITY(1,1) PRIMARY KEY,
                                         SessionID INT NOT NULL,
                                         QrCode NVARCHAR(500) NOT NULL,
                                         StartScanID INT NULL,
                                         EndScanID INT NULL,
                                         StartTime DATETIME2 NOT NULL DEFAULT GETDATE(),
                                         EndTime DATETIME2 NULL,
                                         Completed BIT NOT NULL DEFAULT 0,
                                         CreatedTS DATETIME2 NOT NULL DEFAULT GETDATE(),
                                         UpdatedTS DATETIME2 NOT NULL DEFAULT GETDATE(),

    -- QC-spezifische Felder
                                         QCStatus NVARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'completed', 'aborted'
                                         Priority TINYINT NOT NULL DEFAULT 1, -- 1=Normal, 2=Hoch, 3=Kritisch
                                         EstimatedDurationMinutes INT NULL, -- Geschätzte Bearbeitungszeit
                                         ActualDurationSeconds AS (CASE
            WHEN EndTime IS NOT NULL THEN DATEDIFF(SECOND, StartTime, EndTime)
            ELSE DATEDIFF(SECOND, StartTime, GETDATE())
        END),

    -- Qualitätsdaten
                                         QualityRating TINYINT NULL, -- 1-5 Bewertung (optional)
                                         QualityNotes NVARCHAR(1000) NULL, -- Notizen zur Qualitätsprüfung
                                         DefectsFound BIT DEFAULT 0, -- Mängel gefunden?
                                         DefectDescription NVARCHAR(500) NULL, -- Beschreibung der Mängel

    -- Metadaten
                                         ProcessingLocation NVARCHAR(100) NULL, -- Bearbeitungsort/Station
                                         BatchNumber NVARCHAR(50) NULL, -- Chargennummer falls relevant
                                         ReworkRequired BIT DEFAULT 0, -- Nacharbeit erforderlich?

    -- Foreign Key Constraints
                                         CONSTRAINT FK_QualityControlSteps_Sessions
                                             FOREIGN KEY (SessionID) REFERENCES dbo.Sessions(ID) ON DELETE CASCADE,
                                         CONSTRAINT FK_QualityControlSteps_StartScan
                                             FOREIGN KEY (StartScanID) REFERENCES dbo.QrScans(ID),
                                         CONSTRAINT FK_QualityControlSteps_EndScan
                                             FOREIGN KEY (EndScanID) REFERENCES dbo.QrScans(ID),

    -- Check Constraints
                                         CONSTRAINT CK_QualityControlSteps_Times
                                             CHECK (EndTime IS NULL OR EndTime >= StartTime),
                                         CONSTRAINT CK_QualityControlSteps_Completed
                                             CHECK ((Completed = 0 AND EndTime IS NULL AND EndScanID IS NULL) OR
                                                    (Completed = 1 AND EndTime IS NOT NULL AND EndScanID IS NOT NULL)),
                                         CONSTRAINT CK_QualityControlSteps_Status
                                             CHECK (QCStatus IN ('active', 'completed', 'aborted')),
                                         CONSTRAINT CK_QualityControlSteps_Priority
                                             CHECK (Priority BETWEEN 1 AND 3),
                                         CONSTRAINT CK_QualityControlSteps_QualityRating
                                             CHECK (QualityRating IS NULL OR QualityRating BETWEEN 1 AND 5),
                                         CONSTRAINT CK_QualityControlSteps_DefectLogic
                                             CHECK ((DefectsFound = 0 AND DefectDescription IS NULL) OR
                                                    (DefectsFound = 1 AND DefectDescription IS NOT NULL))
);

PRINT 'QualityControlSteps Tabelle erstellt';
END
ELSE
    PRINT 'QualityControlSteps Tabelle bereits vorhanden';
GO

-- ===== QC-PERFORMANCE-INDEXES =====

-- Index für Session-basierte Abfragen (häufigste Abfrage)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_QualityControlSteps_SessionID_Status')
CREATE NONCLUSTERED INDEX IX_QualityControlSteps_SessionID_Status
ON dbo.QualityControlSteps (SessionID, QCStatus)
INCLUDE (QrCode, Completed, StartTime, EndTime, Priority);
GO

-- Index für QR-Code-basierte Abfragen (für Duplikat-Prüfung)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_QualityControlSteps_QrCode_Active')
CREATE NONCLUSTERED INDEX IX_QualityControlSteps_QrCode_Active
ON dbo.QualityControlSteps (QrCode, QCStatus)
INCLUDE (SessionID, StartTime, EndTime)
WHERE QCStatus = 'active';
GO

-- Index für Zeitraum-basierte Abfragen (Reporting)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_QualityControlSteps_StartTime_Completed')
CREATE NONCLUSTERED INDEX IX_QualityControlSteps_StartTime_Completed
ON dbo.QualityControlSteps (StartTime DESC, Completed)
INCLUDE (SessionID, QrCode, EndTime, QCStatus, Priority);
GO

-- Index für Performance-Monitoring
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_QualityControlSteps_Priority_StartTime')
CREATE NONCLUSTERED INDEX IX_QualityControlSteps_Priority_StartTime
ON dbo.QualityControlSteps (Priority DESC, StartTime)
INCLUDE (SessionID, QrCode, QCStatus, ActualDurationSeconds);
GO

-- ===== QC-AUDIT-TABELLE =====

-- Audit-Log für QC-Änderungen
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'QualityControlAudit')
BEGIN
CREATE TABLE dbo.QualityControlAudit (
                                         ID INT IDENTITY(1,1) PRIMARY KEY,
                                         QCStepID INT NOT NULL,
                                         UserID INT NULL,
                                         ActionType NVARCHAR(50) NOT NULL, -- 'created', 'updated', 'completed', 'aborted'
                                         OldValues NVARCHAR(MAX) NULL, -- JSON der alten Werte
                                         NewValues NVARCHAR(MAX) NULL, -- JSON der neuen Werte
                                         ChangeReason NVARCHAR(500) NULL,
                                         CreatedTS DATETIME2 NOT NULL DEFAULT GETDATE(),

                                         CONSTRAINT FK_QualityControlAudit_QCStep
                                             FOREIGN KEY (QCStepID) REFERENCES dbo.QualityControlSteps(ID) ON DELETE CASCADE,
                                         CONSTRAINT FK_QualityControlAudit_User
                                             FOREIGN KEY (UserID) REFERENCES dbo.ScannBenutzer(ID),
                                         CONSTRAINT CK_QualityControlAudit_ActionType
                                             CHECK (ActionType IN ('created', 'updated', 'completed', 'aborted', 'quality_rated'))
);

PRINT 'QualityControlAudit Tabelle erstellt';
END
ELSE
    PRINT 'QualityControlAudit Tabelle bereits vorhanden';
GO

-- ===== QC-KONFIGURATIONSTABELLE =====

-- QC-Konfiguration pro SessionType
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'QualityControlConfig')
BEGIN
CREATE TABLE dbo.QualityControlConfig (
                                          ID INT IDENTITY(1,1) PRIMARY KEY,
                                          SessionTypeName NVARCHAR(100) NOT NULL,

    -- QC-Einstellungen
                                          RequiresBothScans BIT NOT NULL DEFAULT 1, -- Eingang UND Ausgang erforderlich?
                                          AllowParallelSteps BIT NOT NULL DEFAULT 1, -- Mehrere QC-Schritte parallel?
                                          MaxParallelSteps INT NOT NULL DEFAULT 10, -- Maximale parallele Schritte
                                          DefaultPriority TINYINT NOT NULL DEFAULT 1,
                                          AutoTimeoutMinutes INT NULL, -- Automatisches Timeout für QC-Schritte

    -- Qualitätsbewertung
                                          RequireQualityRating BIT NOT NULL DEFAULT 0,
                                          RequireDefectCheck BIT NOT NULL DEFAULT 1,
                                          AllowRework BIT NOT NULL DEFAULT 1,

    -- Benachrichtigungen
                                          NotifyOnLongDuration BIT NOT NULL DEFAULT 1,
                                          LongDurationThresholdMinutes INT NOT NULL DEFAULT 30,
                                          NotifyOnDefects BIT NOT NULL DEFAULT 1,

                                          CreatedTS DATETIME2 NOT NULL DEFAULT GETDATE(),
                                          UpdatedTS DATETIME2 NOT NULL DEFAULT GETDATE(),

                                          CONSTRAINT UK_QualityControlConfig_SessionType
                                              UNIQUE (SessionTypeName),
                                          CONSTRAINT CK_QualityControlConfig_Priority
                                              CHECK (DefaultPriority BETWEEN 1 AND 3),
                                          CONSTRAINT CK_QualityControlConfig_MaxSteps
                                              CHECK (MaxParallelSteps > 0 AND MaxParallelSteps <= 50)
);

PRINT 'QualityControlConfig Tabelle erstellt';
END
ELSE
    PRINT 'QualityControlConfig Tabelle bereits vorhanden';
GO

-- ===== STANDARD QC-KONFIGURATION =====

-- Standard-Konfiguration für Qualitätskontrolle einfügen
IF NOT EXISTS (SELECT * FROM QualityControlConfig WHERE SessionTypeName = 'Qualitätskontrolle')
BEGIN
INSERT INTO QualityControlConfig (
    SessionTypeName, RequiresBothScans, AllowParallelSteps, MaxParallelSteps,
    DefaultPriority, AutoTimeoutMinutes, RequireQualityRating, RequireDefectCheck,
    AllowRework, NotifyOnLongDuration, LongDurationThresholdMinutes, NotifyOnDefects
) VALUES (
             'Qualitätskontrolle', 1, 1, 10, 1, 120, 0, 1, 1, 1, 30, 1
         );

PRINT 'Standard QC-Konfiguration eingefügt';
END;
GO

-- ===== QC-VIEWS FÜR REPORTING =====

-- View: QC-Schritte mit Session-Details
IF OBJECT_ID('dbo.vw_QCStepsWithSession') IS NOT NULL
DROP VIEW dbo.vw_QCStepsWithSession;
GO

CREATE VIEW dbo.vw_QCStepsWithSession AS
SELECT
    qcs.ID,
    qcs.SessionID,
    qcs.QrCode,
    qcs.StartScanID,
    qcs.EndScanID,
    qcs.StartTime,
    qcs.EndTime,
    qcs.Completed,
    qcs.QCStatus,
    qcs.Priority,
    qcs.ActualDurationSeconds,
    qcs.QualityRating,
    qcs.DefectsFound,
    qcs.ReworkRequired,

    -- Session-Details
    s.UserID,
    s.StartTS AS SessionStart,
    s.SessionType,
    sb.BenutzerName AS UserName,
    sb.Abteilung AS Department,

    -- Berechnete Felder
    CASE
        WHEN qcs.Completed = 1 THEN 'Abgeschlossen'
        WHEN qcs.QCStatus = 'aborted' THEN 'Abgebrochen'
        WHEN qcs.ActualDurationSeconds > 1800 THEN 'Überfällig' -- 30 Minuten
        ELSE 'Aktiv'
        END AS DisplayStatus,

    CASE
        WHEN qcs.Priority = 3 THEN 'Kritisch'
        WHEN qcs.Priority = 2 THEN 'Hoch'
        ELSE 'Normal'
        END AS PriorityText

FROM dbo.QualityControlSteps qcs
         INNER JOIN dbo.Sessions s ON qcs.SessionID = s.ID
         INNER JOIN dbo.ScannBenutzer sb ON s.UserID = sb.ID;
GO

-- View: Tägliche QC-Statistiken
IF OBJECT_ID('dbo.vw_DailyQCStats') IS NOT NULL
DROP VIEW dbo.vw_DailyQCStats;
GO

CREATE VIEW dbo.vw_DailyQCStats AS
SELECT
    CAST(StartTime AS DATE) AS Date,
    SessionID,
    UserID,
    UserName,
    Department,

    -- Mengen-Statistiken
    COUNT(*) AS TotalSteps,
    SUM(CASE WHEN Completed = 1 THEN 1 ELSE 0 END) AS CompletedSteps,
    SUM(CASE WHEN QCStatus = 'active' THEN 1 ELSE 0 END) AS ActiveSteps,
    SUM(CASE WHEN QCStatus = 'aborted' THEN 1 ELSE 0 END) AS AbortedSteps,

    -- Qualitäts-Statistiken
    SUM(CASE WHEN DefectsFound = 1 THEN 1 ELSE 0 END) AS StepsWithDefects,
    SUM(CASE WHEN ReworkRequired = 1 THEN 1 ELSE 0 END) AS StepsRequiringRework,
    AVG(CAST(QualityRating AS FLOAT)) AS AvgQualityRating,

    -- Zeit-Statistiken
    AVG(CASE WHEN Completed = 1 THEN ActualDurationSeconds ELSE NULL END) AS AvgDurationSeconds,
    MIN(StartTime) AS FirstStepTime,
    MAX(ISNULL(EndTime, StartTime)) AS LastStepTime,

    -- Prioritäts-Verteilung
    SUM(CASE WHEN Priority = 3 THEN 1 ELSE 0 END) AS CriticalSteps,
    SUM(CASE WHEN Priority = 2 THEN 1 ELSE 0 END) AS HighPrioritySteps,
    SUM(CASE WHEN Priority = 1 THEN 1 ELSE 0 END) AS NormalSteps

FROM dbo.vw_QCStepsWithSession
GROUP BY CAST(StartTime AS DATE), SessionID, UserID, UserName, Department;
GO

-- View: QC-Performance-Übersicht
IF OBJECT_ID('dbo.vw_QCPerformanceOverview') IS NOT NULL
DROP VIEW dbo.vw_QCPerformanceOverview;
GO

CREATE VIEW dbo.vw_QCPerformanceOverview AS
SELECT
    UserID,
    UserName,
    Department,

    -- Aktueller Status
    COUNT(CASE WHEN QCStatus = 'active' THEN 1 END) AS CurrentActiveSteps,
    COUNT(CASE WHEN CAST(StartTime AS DATE) = CAST(GETDATE() AS DATE) THEN 1 END) AS TodaySteps,
    COUNT(CASE WHEN CAST(StartTime AS DATE) = CAST(GETDATE() AS DATE) AND Completed = 1 THEN 1 END) AS TodayCompletedSteps,

    -- Performance-Metriken
    AVG(CASE WHEN Completed = 1 THEN CAST(ActualDurationSeconds AS FLOAT) ELSE NULL END) AS AvgCompletionTimeSeconds,
    COUNT(CASE WHEN Completed = 1 THEN 1 END) AS TotalCompletedSteps,
    COUNT(CASE WHEN QCStatus = 'aborted' THEN 1 END) AS TotalAbortedSteps,

    -- Qualitäts-Metriken
    CASE
        WHEN COUNT(CASE WHEN Completed = 1 THEN 1 END) > 0
            THEN CAST(COUNT(CASE WHEN DefectsFound = 1 THEN 1 END) AS FLOAT) / COUNT(CASE WHEN Completed = 1 THEN 1 END) * 100
        ELSE 0
        END AS DefectRatePercent,

    AVG(CAST(QualityRating AS FLOAT)) AS AvgQualityRating,

    -- Aktivitäts-Zeitraum
    MIN(StartTime) AS FirstActivityTime,
    MAX(ISNULL(EndTime, StartTime)) AS LastActivityTime

FROM dbo.vw_QCStepsWithSession
GROUP BY UserID, UserName, Department;
GO

-- ===== QC-STORED PROCEDURES =====

-- Procedure: QC-Schritt starten
IF OBJECT_ID('dbo.sp_StartQCStep') IS NOT NULL
DROP PROCEDURE dbo.sp_StartQCStep;
GO

CREATE PROCEDURE dbo.sp_StartQCStep
    @SessionID INT,
    @QrCode NVARCHAR(500),
    @StartScanID INT,
    @Priority TINYINT = 1
AS
BEGIN
    SET NOCOUNT ON;

BEGIN TRY
BEGIN TRANSACTION;

        -- Prüfe ob bereits aktiver Schritt für diesen QR-Code in dieser Session existiert
        IF EXISTS (
            SELECT 1 FROM QualityControlSteps
            WHERE SessionID = @SessionID
              AND QrCode = @QrCode
              AND QCStatus = 'active'
        )
BEGIN
            RAISERROR('QC-Schritt für diesen QR-Code ist bereits aktiv in dieser Session', 16, 1);
            RETURN;
END

        -- QC-Schritt erstellen
INSERT INTO QualityControlSteps (
    SessionID, QrCode, StartScanID, StartTime,
    QCStatus, Priority, Completed
)
VALUES (
           @SessionID, @QrCode, @StartScanID, GETDATE(),
           'active', @Priority, 0
       );

DECLARE @QCStepID INT = SCOPE_IDENTITY();

        -- Audit-Eintrag
INSERT INTO QualityControlAudit (QCStepID, ActionType, NewValues)
VALUES (@QCStepID, 'created', '{"status":"active","priority":' + CAST(@Priority AS NVARCHAR) + '}');

-- Ergebnis zurückgeben
SELECT
    ID, SessionID, QrCode, StartScanID, StartTime,
    QCStatus, Priority, Completed, ActualDurationSeconds
FROM QualityControlSteps
WHERE ID = @QCStepID;

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
ROLLBACK TRANSACTION;
        THROW;
END CATCH
END;
GO

-- Procedure: QC-Schritt abschließen
IF OBJECT_ID('dbo.sp_CompleteQCStep') IS NOT NULL
DROP PROCEDURE dbo.sp_CompleteQCStep;
GO

CREATE PROCEDURE dbo.sp_CompleteQCStep
    @SessionID INT,
    @QrCode NVARCHAR(500),
    @EndScanID INT,
    @QualityRating TINYINT = NULL,
    @DefectsFound BIT = 0,
    @DefectDescription NVARCHAR(500) = NULL,
    @QualityNotes NVARCHAR(1000) = NULL
AS
BEGIN
    SET NOCOUNT ON;

BEGIN TRY
BEGIN TRANSACTION;

        -- Finde aktiven QC-Schritt
        DECLARE @QCStepID INT;
SELECT TOP 1 @QCStepID = ID
FROM QualityControlSteps
WHERE SessionID = @SessionID
  AND QrCode = @QrCode
  AND QCStatus = 'active'
ORDER BY StartTime DESC;

IF @QCStepID IS NULL
BEGIN
            RAISERROR('Kein aktiver QC-Schritt für diesen QR-Code in dieser Session gefunden', 16, 1);
            RETURN;
END

        -- QC-Schritt abschließen
UPDATE QualityControlSteps
SET
    EndScanID = @EndScanID,
    EndTime = GETDATE(),
    Completed = 1,
    QCStatus = 'completed',
    QualityRating = @QualityRating,
    DefectsFound = @DefectsFound,
    DefectDescription = @DefectDescription,
    QualityNotes = @QualityNotes,
    ReworkRequired = CASE WHEN @DefectsFound = 1 THEN 1 ELSE 0 END,
    UpdatedTS = GETDATE()
WHERE ID = @QCStepID;

-- Audit-Eintrag
DECLARE @AuditData NVARCHAR(MAX) = '{"status":"completed","defects":' +
            CASE WHEN @DefectsFound = 1 THEN 'true' ELSE 'false' END +
            CASE WHEN @QualityRating IS NOT NULL THEN ',"rating":' + CAST(@QualityRating AS NVARCHAR) ELSE '' END + '}';

INSERT INTO QualityControlAudit (QCStepID, ActionType, NewValues)
VALUES (@QCStepID, 'completed', @AuditData);

-- Ergebnis zurückgeben
SELECT
    ID, SessionID, QrCode, StartScanID, EndScanID,
    StartTime, EndTime, QCStatus, Priority, Completed,
    ActualDurationSeconds, QualityRating, DefectsFound,
    DefectDescription, QualityNotes, ReworkRequired
FROM QualityControlSteps
WHERE ID = @QCStepID;

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
ROLLBACK TRANSACTION;
        THROW;
END CATCH
END;
GO

-- Procedure: Aktive QC-Schritte einer Session abbrechen
IF OBJECT_ID('dbo.sp_AbortActiveQCSteps') IS NOT NULL
DROP PROCEDURE dbo.sp_AbortActiveQCSteps;
GO

CREATE PROCEDURE dbo.sp_AbortActiveQCSteps
    @SessionID INT,
    @AbortReason NVARCHAR(500) = 'Session beendet'
AS
BEGIN
    SET NOCOUNT ON;

BEGIN TRY
BEGIN TRANSACTION;

        -- Alle aktiven QC-Schritte der Session abbrechen
UPDATE QualityControlSteps
SET
    QCStatus = 'aborted',
    EndTime = GETDATE(),
    QualityNotes = COALESCE(QualityNotes + ' | ', '') + @AbortReason,
    UpdatedTS = GETDATE()
WHERE SessionID = @SessionID AND QCStatus = 'active';

DECLARE @AbortedCount INT = @@ROWCOUNT;

        -- Audit-Einträge für abgebrochene Schritte
        IF @AbortedCount > 0
BEGIN
INSERT INTO QualityControlAudit (QCStepID, ActionType, NewValues)
SELECT ID, 'aborted', '{"reason":"' + @AbortReason + '"}'
FROM QualityControlSteps
WHERE SessionID = @SessionID AND QCStatus = 'aborted' AND UpdatedTS >= DATEADD(SECOND, -5, GETDATE());
END

SELECT @AbortedCount AS AbortedStepsCount;

COMMIT TRANSACTION;
END TRY
BEGIN CATCH
ROLLBACK TRANSACTION;
        THROW;
END CATCH
END;
GO

-- ===== QC-FUNKTIONEN =====

-- Function: QC-Schritt-Status berechnen
IF OBJECT_ID('dbo.fn_GetQCStepStatus') IS NOT NULL
DROP FUNCTION dbo.fn_GetQCStepStatus;
GO

CREATE FUNCTION dbo.fn_GetQCStepStatus(@QCStepID INT)
    RETURNS NVARCHAR(20)
                    AS
BEGIN
    DECLARE @Status NVARCHAR(20);

SELECT @Status =
       CASE
           WHEN QCStatus = 'completed' THEN 'completed'
           WHEN QCStatus = 'aborted' THEN 'aborted'
           WHEN ActualDurationSeconds > 3600 THEN 'overdue' -- 1 Stunde
           WHEN ActualDurationSeconds > 1800 THEN 'delayed' -- 30 Minuten
           ELSE 'active'
           END
FROM QualityControlSteps
WHERE ID = @QCStepID;

RETURN ISNULL(@Status, 'unknown');
END;
GO

-- ===== QC-TRIGGER =====

-- Trigger: Automatische UpdatedTS Aktualisierung
IF OBJECT_ID('dbo.tr_QualityControlSteps_Update') IS NOT NULL
DROP TRIGGER dbo.tr_QualityControlSteps_Update;
GO

CREATE TRIGGER dbo.tr_QualityControlSteps_Update
    ON dbo.QualityControlSteps
    AFTER UPDATE
              AS
BEGIN
    SET NOCOUNT ON;

UPDATE qcs
SET UpdatedTS = GETDATE()
    FROM QualityControlSteps qcs
    INNER JOIN inserted i ON qcs.ID = i.ID
WHERE qcs.UpdatedTS = i.UpdatedTS; -- Nur wenn UpdatedTS nicht manuell gesetzt wurde
END;
GO

-- ===== ABSCHLUSS =====

-- Berechtigungen für QC-Objekte setzen (falls nötig)
-- GRANT SELECT, INSERT, UPDATE ON QualityControlSteps TO [QualityControlUsers];
-- GRANT EXECUTE ON sp_StartQCStep TO [QualityControlUsers];
-- GRANT EXECUTE ON sp_CompleteQCStep TO [QualityControlUsers];

PRINT '';
PRINT '================================================================';
PRINT 'Qualitätskontrolle Datenbankschema erfolgreich erstellt!';
PRINT '';
PRINT 'Erstellte Objekte:';
PRINT '- QualityControlSteps (Haupttabelle)';
PRINT '- QualityControlAudit (Audit-Log)';
PRINT '- QualityControlConfig (Konfiguration)';
PRINT '- 4 Performance-Indexes';
PRINT '- 3 Reporting-Views';
PRINT '- 3 Stored Procedures';
PRINT '- 1 Function';
PRINT '- 1 Trigger';
PRINT '';
PRINT 'Das Schema ist bereit für den QC-Betrieb!';
PRINT '================================================================';
GO