/* =============================================================================
   033_smoke_bloque_terminal_dueno_equipo.sql — SIEI

   Smoke test de migración 026: bloque_terminal admite EQUIPO como cuarto
   dueño posible. 4 casos:
     1. Crear un bloque_terminal con equipo_id -> debe pasar (antes del
        cambio, el CHECK de 3 vías lo hubiera rechazado si equipo_id fuera
        la única columna poblada... en realidad ni siquiera existía la
        columna).
     2. CHECK XOR sigue rechazando dos dueños a la vez (ahora con 4
        columnas, caja_id + equipo_id juntos debe fallar igual).
     3. Terminación sobre un terminal de un bloque de EQUIPO, cuyo
        punto_conexion real es ESE MISMO equipo -> debe pasar (antes,
        TR_terminacion_validar_propietario_y_canal rechazaba cualquier
        extremo de equipo de forma incondicional).
     4. Terminación sobre un terminal de un bloque de EQUIPO, cuyo
        punto_conexion real es un equipo DISTINTO -> debe rechazar (51024).

   Usa el proyecto TEST-001 (creado por tests anteriores) y limpia sus
   propios fixtures al final. PRINT PASS/FAIL, no falla el proceso (mismo
   criterio que el resto de database/tests).
   ============================================================================= */

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

SET NOCOUNT ON;
DECLARE @proyecto_id BIGINT = (SELECT id FROM nucleo.proyecto WHERE codigo_proyecto = 'TEST-001');

IF @proyecto_id IS NULL
BEGIN
    PRINT 'FAIL — no existe el proyecto TEST-001 (correr los tests anteriores primero).';
    RETURN;
END

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @equipo1_id BIGINT, @equipo2_id BIGINT, @bloque_id BIGINT, @terminal_id BIGINT, @posicion_id BIGINT;
    DECLARE @punto_eq1_id BIGINT, @ruta_id BIGINT, @tramo_id BIGINT, @conductor_id BIGINT, @cable_id BIGINT, @tramo_conductor_id BIGINT;

    INSERT INTO nucleo.equipo (proyecto_id, tag_equipo, descripcion, activo, created_at)
    VALUES (@proyecto_id, N'TEST-EQ-BT-1', N'Equipo de prueba 033 (1)', 1, SYSUTCDATETIME());
    SET @equipo1_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.equipo (proyecto_id, tag_equipo, descripcion, activo, created_at)
    VALUES (@proyecto_id, N'TEST-EQ-BT-2', N'Equipo de prueba 033 (2)', 1, SYSUTCDATETIME());
    SET @equipo2_id = SCOPE_IDENTITY();

    -- --- Caso 1: bloque_terminal con equipo_id ---
    BEGIN TRY
        INSERT INTO nucleo.bloque_terminal (proyecto_id, equipo_id, codigo, activo, created_at)
        VALUES (@proyecto_id, @equipo1_id, N'TEST-TB-EQ', 1, SYSUTCDATETIME());
        SET @bloque_id = SCOPE_IDENTITY();
        PRINT 'PASS — caso 1: bloque_terminal con equipo_id se crea correctamente.';
    END TRY
    BEGIN CATCH
        PRINT 'FAIL — caso 1: ' + ERROR_MESSAGE();
    END CATCH

    -- --- Caso 2: XOR sigue rechazando dos dueños a la vez ---
    BEGIN TRY
        INSERT INTO nucleo.bloque_terminal (proyecto_id, caja_id, equipo_id, codigo, activo, created_at)
        SELECT TOP 1 @proyecto_id, c.id, @equipo1_id, N'TEST-TB-XOR', 1, SYSUTCDATETIME()
        FROM nucleo.caja c WHERE c.proyecto_id = @proyecto_id;
        PRINT 'FAIL — caso 2: debió rechazar caja_id + equipo_id juntos (CK_bloque_terminal_pertenencia_xor).';
    END TRY
    BEGIN CATCH
        IF ERROR_MESSAGE() LIKE '%CK_bloque_terminal_pertenencia_xor%'
            PRINT 'PASS — caso 2: CK_bloque_terminal_pertenencia_xor rechaza dos dueños a la vez.';
        ELSE
            PRINT 'FAIL — caso 2: error inesperado: ' + ERROR_MESSAGE();
    END CATCH

    -- --- Fixture común para casos 3 y 4: un terminal+posición reales en el bloque del equipo 1 ---
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero, activo, created_at)
    VALUES (@proyecto_id, @bloque_id, N'1', 1, SYSUTCDATETIME());
    SET @terminal_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo, activo, created_at)
    VALUES (@proyecto_id, @terminal_id, N'A', 1, SYSUTCDATETIME());
    SET @posicion_id = SCOPE_IDENTITY();

    -- Un punto_conexion real cuyo dueño es el equipo 1 (el mismo del bloque).
    INSERT INTO nucleo.punto_conexion (proyecto_id, equipo_id, activo, created_at)
    VALUES (@proyecto_id, @equipo1_id, 1, SYSUTCDATETIME());
    SET @punto_eq1_id = SCOPE_IDENTITY();

    -- Un punto_conexion "gabinete" cualquiera para el otro extremo del tramo.
    DECLARE @punto_gab_id BIGINT;
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id, activo, created_at)
    SELECT TOP 1 @proyecto_id, g.id, 1, SYSUTCDATETIME()
    FROM nucleo.gabinete g WHERE g.proyecto_id = @proyecto_id;
    SET @punto_gab_id = SCOPE_IDENTITY();

    -- Una señal + ruta + tramo real (numero_orden=1, origen=equipo1, destino=gabinete).
    DECLARE @senal_id BIGINT;
    SELECT TOP 1 @senal_id = s.id FROM nucleo.senal s
    JOIN cat.cat_clase_senal cs ON cs.id = s.clase_senal_id AND cs.codigo = 'CONTROL'
    WHERE s.proyecto_id = @proyecto_id AND s.activo = 1 AND s.instrumento_id IS NULL AND s.equipo_id IS NULL;

    IF @senal_id IS NULL
    BEGIN
        -- Crea una señal CONTROL de prueba, sin dueño, solo para poder armar la ruta.
        DECLARE @clase_control_id BIGINT = (SELECT id FROM cat.cat_clase_senal WHERE codigo = 'CONTROL');
        INSERT INTO nucleo.senal (proyecto_id, clase_senal_id, dueno_ausente, activo, created_at)
        VALUES (@proyecto_id, @clase_control_id, 1, 1, SYSUTCDATETIME());
        SET @senal_id = SCOPE_IDENTITY();
    END

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id, activo, created_at)
    VALUES (@proyecto_id, @senal_id, 1, SYSUTCDATETIME());
    SET @ruta_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, numero_orden, punto_origen_id, punto_destino_id, activo, created_at)
    VALUES (@proyecto_id, @ruta_id, 1, @punto_eq1_id, @punto_gab_id, 1, SYSUTCDATETIME());
    SET @tramo_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores, activo, created_at)
    VALUES (@proyecto_id, N'TEST-CABLE-033', 2, 1, SYSUTCDATETIME());
    SET @cable_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo, activo, created_at)
    VALUES (@proyecto_id, @cable_id, N'1', 1, SYSUTCDATETIME());
    SET @conductor_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id, activo, created_at)
    VALUES (@proyecto_id, @tramo_id, @conductor_id, 1, SYSUTCDATETIME());
    SET @tramo_conductor_id = SCOPE_IDENTITY();

    -- --- Caso 3: terminación cuyo punto_conexion real ES el equipo dueño del bloque -> debe pasar ---
    BEGIN TRY
        INSERT INTO nucleo.terminacion (proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo, activo, created_at)
        VALUES (@proyecto_id, @tramo_conductor_id, @posicion_id, N'ORIGEN', 1, SYSUTCDATETIME());
        PRINT 'PASS — caso 3: terminación sobre bloque de EQUIPO con punto_conexion del MISMO equipo se acepta.';
    END TRY
    BEGIN CATCH
        PRINT 'FAIL — caso 3: ' + ERROR_MESSAGE();
    END CATCH

    -- --- Caso 4: mover el tramo a un origen de un equipo DISTINTO -> la terminación ya insertada debe quedar inválida ---
    BEGIN TRY
        INSERT INTO nucleo.punto_conexion (proyecto_id, equipo_id, activo, created_at)
        VALUES (@proyecto_id, @equipo2_id, 1, SYSUTCDATETIME());
        DECLARE @punto_eq2_id BIGINT = SCOPE_IDENTITY();

        UPDATE nucleo.tramo_conexion SET punto_origen_id = @punto_eq2_id WHERE id = @tramo_id;
        -- Re-disparar el trigger de terminación con un UPDATE inocuo, para que
        -- re-valide contra el nuevo punto_origen (el trigger es AFTER INSERT,
        -- UPDATE sobre terminacion, no sobre tramo_conexion).
        UPDATE nucleo.terminacion SET updated_at = SYSUTCDATETIME() WHERE tramo_conductor_id = @tramo_conductor_id;
        PRINT 'FAIL — caso 4: debió rechazar la terminación tras cambiar el origen a un equipo distinto (51024).';
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER() = 51024
            PRINT 'PASS — caso 4: terminación con punto_conexion de un equipo DISTINTO al del bloque se rechaza (51024).';
        ELSE
            PRINT 'FAIL — caso 4: error inesperado: ' + ERROR_MESSAGE();
    END CATCH

    -- El caso 4 espera que el trigger dispare su propio ROLLBACK
    -- TRANSACTION (mismo patrón que el resto de esta suite, ver 027) —
    -- @@TRANCOUNT ya puede ser 0 acá, así que este cierre es condicional.
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL — error inesperado en el test: ' + ERROR_MESSAGE();
END CATCH
