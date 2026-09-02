/* =============================================================================
   028_smoke_senal_dueno_ausente.sql — Smoke test de la migracion 016
   (nucleo.senal.dueno_ausente + CK_senal_origen_xor relajado).

   Requiere el proyecto fixture TEST-001 (creado por pruebas anteriores).
   Autocontenido: crea su propio instrumento/equipo/señal con TAGs unicos
   por corrida, hace ROLLBACK de todo al final (no deja residuo).
   ============================================================================= */

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

DECLARE @proyecto_id BIGINT = (SELECT id FROM nucleo.proyecto WHERE codigo_proyecto = 'TEST-001');
DECLARE @sufijo NVARCHAR(20) = CONVERT(NVARCHAR(20), DATEDIFF(SECOND, '2020-01-01', SYSUTCDATETIME()));
DECLARE @clase_control_id BIGINT = (SELECT id FROM cat.cat_clase_senal WHERE codigo = 'CONTROL');
DECLARE @inst_id BIGINT, @senal_id BIGINT;

PRINT '=== 028: dueno_ausente / CK_senal_origen_xor relajado ===';

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento, activo, created_at)
    VALUES (@proyecto_id, CONCAT('TEST-028-INST-', @sufijo), 1, SYSUTCDATETIME());
    SET @inst_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, nombre_corto, activo, created_at)
    VALUES (@proyecto_id, @inst_id, @clase_control_id, 'PI', 1, SYSUTCDATETIME());
    SET @senal_id = SCOPE_IDENTITY();

    PRINT 'PASS 1: señal normal (dueno_ausente=0 por default, exactamente un dueño) se crea sin problema.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 1: ' + ERROR_MESSAGE();
END CATCH;


BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento, activo, created_at)
    VALUES (@proyecto_id, CONCAT('TEST-028-INST2-', @sufijo), 1, SYSUTCDATETIME());
    SET @inst_id = SCOPE_IDENTITY();

    -- Intento directo: ambos dueños NULL sin marcar dueno_ausente -> debe
    -- seguir rechazado exactamente igual que antes de 016 (error 547, CK).
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, equipo_id, clase_senal_id, nombre_corto, dueno_ausente, activo, created_at)
    VALUES (@proyecto_id, NULL, NULL, @clase_control_id, 'PI', 0, 1, SYSUTCDATETIME());

    PRINT 'FAIL 2: se permitio crear una señal sin dueño y sin dueno_ausente=1 (CK_senal_origen_xor no protegio).';
    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 547
        PRINT 'PASS 2: sin dueño y dueno_ausente=0 sigue rechazado por CK_senal_origen_xor (547), como antes de 016.';
    ELSE
        PRINT 'FAIL 2: error inesperado -- ' + ERROR_MESSAGE();
END CATCH;


BEGIN TRY
    BEGIN TRANSACTION;

    -- Con dueno_ausente=1 y ambos dueños NULL -> ahora sí debe aceptarse
    -- (el estado explícito que motivó la migración 016).
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, equipo_id, clase_senal_id, nombre_corto, dueno_ausente, activo, created_at)
    VALUES (@proyecto_id, NULL, NULL, @clase_control_id, 'PI', 1, 1, SYSUTCDATETIME());

    PRINT 'PASS 3: señal con dueno_ausente=1 y ambos dueños NULL se crea sin problema.';
    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 3: ' + ERROR_MESSAGE();
END CATCH;


BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento, activo, created_at)
    VALUES (@proyecto_id, CONCAT('TEST-028-INST3-', @sufijo), 1, SYSUTCDATETIME());
    SET @inst_id = SCOPE_IDENTITY();

    -- dueno_ausente=1 PERO con un dueño real puesto -> debe rechazarse
    -- (dueno_ausente=1 exige CERO dueños, no "cero o más").
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, nombre_corto, dueno_ausente, activo, created_at)
    VALUES (@proyecto_id, @inst_id, @clase_control_id, 'PI', 1, 1, SYSUTCDATETIME());

    PRINT 'FAIL 4: se permitio dueno_ausente=1 con un instrumento_id real puesto (deberia exigir cero dueños).';
    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 547
        PRINT 'PASS 4: dueno_ausente=1 con un dueño real puesto se rechaza (547) -- dueno_ausente exige cero dueños, no "cero o mas".';
    ELSE
        PRINT 'FAIL 4: error inesperado -- ' + ERROR_MESSAGE();
END CATCH;

PRINT '=== Fin 028 ===';
GO
