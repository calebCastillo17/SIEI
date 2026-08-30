SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 027 - TERMINACIONES: nucleo.conductor, nucleo.bloque_terminal,
 * nucleo.terminal, nucleo.posicion_terminal, nucleo.tramo_conductor,
 * nucleo.terminacion, cat.cat_modulo_io_terminal (migracion 015), mas la
 * evolucion legacy de tramo_conexion.par_conductor_id (NOT NULL -> NULL).
 *
 * Varios de los triggers nuevos hacen su propio ROLLBACK TRANSACTION
 * interno (mismo motivo documentado en 025_smoke_senales_opcionales.sql):
 * cada caso que deliberadamente dispara un rechazo vive en su propio
 * BEGIN TRY/BEGIN TRANSACTION, nunca comparte transaccion con otro caso.
 *
 * Fixture de catalogo PERMANENTE (no se revierte, mismo patron que
 * 001_smoke_modulo.sql/002_smoke_asignacion_io.sql/011_smoke_capacidad_
 * modulo.sql, que ya acumulan filas de prueba en cat.cat_modulo_io): un
 * modelo de modulo dedicado "SIEI TEST-027 RTD4" con 2 canales, y sus
 * filas de cat.cat_modulo_io_terminal — canal 0 con 3 terminales (caso
 * RTD real: 2 etiquetas iguales "IN_0/A" + "IN_0/RTD C", distinguidas por
 * orden_terminal) y canal 1 con 1 terminal simple. Un segundo modelo
 * "SIEI TEST-027 SIMPLE2" (2 canales, 1 terminal cada uno) para probar el
 * cambio de catalogo de un modulo ya instalado.
 */

DECLARE @proyecto_id BIGINT;
DECLARE @tipo_ai_id BIGINT;
DECLARE @clase_control_id BIGINT;
DECLARE @tipo_gabinete_rio_id BIGINT;

SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 52701, 'No existe TEST-001.', 1;

SELECT @tipo_ai_id = id FROM cat.cat_tipo_io WHERE codigo = N'AI';
SELECT @clase_control_id = id FROM cat.cat_clase_senal WHERE codigo = N'CONTROL';
SELECT @tipo_gabinete_rio_id = id FROM cat.cat_tipo_gabinete WHERE codigo = N'RIO';

PRINT '=========================================';
PRINT 'TEST 027 - TERMINACIONES (migracion 015)';
PRINT '=========================================';


/* ============================================================
   FIXTURE PERMANENTE DE CATALOGO (no se revierte)
   ============================================================ */

DECLARE @catalogo_rtd_id BIGINT, @catalogo_simple2_id BIGINT;

SELECT @catalogo_rtd_id = id FROM cat.cat_modulo_io WHERE fabricante = N'SIEI TEST' AND modelo = N'TEST-027-RTD4';
IF @catalogo_rtd_id IS NULL
BEGIN
    INSERT INTO cat.cat_modulo_io (fabricante, modelo, tipo_io_id, canales_max)
    VALUES (N'SIEI TEST', N'TEST-027-RTD4', @tipo_ai_id, 2);
    SET @catalogo_rtd_id = SCOPE_IDENTITY();

    INSERT INTO cat.cat_modulo_io_terminal (catalogo_modulo_id, numero_canal, orden_terminal, etiqueta_terminal) VALUES
        (@catalogo_rtd_id, 0, 1, N'IN_0/A'),
        (@catalogo_rtd_id, 0, 2, N'IN_0/A'),
        (@catalogo_rtd_id, 0, 3, N'IN_0/RTD C'),
        (@catalogo_rtd_id, 1, 1, N'IN_1');
END

SELECT @catalogo_simple2_id = id FROM cat.cat_modulo_io WHERE fabricante = N'SIEI TEST' AND modelo = N'TEST-027-SIMPLE2';
IF @catalogo_simple2_id IS NULL
BEGIN
    INSERT INTO cat.cat_modulo_io (fabricante, modelo, tipo_io_id, canales_max)
    VALUES (N'SIEI TEST', N'TEST-027-SIMPLE2', @tipo_ai_id, 2);
    SET @catalogo_simple2_id = SCOPE_IDENTITY();

    INSERT INTO cat.cat_modulo_io_terminal (catalogo_modulo_id, numero_canal, orden_terminal, etiqueta_terminal) VALUES
        (@catalogo_simple2_id, 0, 1, N'X0'),
        (@catalogo_simple2_id, 1, 1, N'X1');
END

IF (SELECT COUNT(*) FROM cat.cat_modulo_io_terminal WHERE catalogo_modulo_id = @catalogo_rtd_id) = 4
    PRINT 'PASS 0: fixture de catalogo cat_modulo_io_terminal (RTD4) tiene 4 filas.';
ELSE
    PRINT 'FAIL 0: fixture de catalogo RTD4 no tiene 4 filas.';


/* ============================================================
   CASO 1
   CABLE CON CONDUCTORES INDIVIDUALES (SIN PAR) -> PERMITIDO
   Caso real: 620-HV-5084, cable "1-19c#14 AWG".
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @cable1_id BIGINT;
    INSERT INTO nucleo.cable (proyecto_id, tag_cable, tipo_cable, capacidad_conductores)
    VALUES (@proyecto_id, N'027-CABLE-19C', N'1-19c#14 AWG', 19);
    SET @cable1_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES
        (@proyecto_id, @cable1_id, N'1'),
        (@proyecto_id, @cable1_id, N'2'),
        (@proyecto_id, @cable1_id, N'3');

    IF (SELECT COUNT(*) FROM nucleo.conductor WHERE cable_id = @cable1_id AND par_conductor_id IS NULL AND activo = 1) = 3
        PRINT 'PASS 1: cable de conductores individuales (sin par) creado correctamente.';
    ELSE
        PRINT 'FAIL 1: no se crearon los 3 conductores sin par.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 1: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2
   CABLE CON PAR + DOS CONDUCTORES -> PERMITIDO, MISMO CABLE
   GARANTIZADO EN BD (FK_conductor_par_mismo_cable)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @cable2_id BIGINT, @par2_id BIGINT, @condA_id BIGINT, @condB_id BIGINT;
    INSERT INTO nucleo.cable (proyecto_id, tag_cable, tipo_cable, capacidad_conductores)
    VALUES (@proyecto_id, N'027-CABLE-1P', N'1-1p#16 AWG+SH', 2);
    SET @cable2_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.par_conductor (proyecto_id, cable_id, numero_par)
    VALUES (@proyecto_id, @cable2_id, 1);
    SET @par2_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo, par_conductor_id)
    VALUES (@proyecto_id, @cable2_id, N'BK', @par2_id);
    SET @condA_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo, par_conductor_id)
    VALUES (@proyecto_id, @cable2_id, N'WH', @par2_id);
    SET @condB_id = SCOPE_IDENTITY();

    IF (SELECT COUNT(*) FROM nucleo.conductor WHERE par_conductor_id = @par2_id AND activo = 1) = 2
        PRINT 'PASS 2: cable de par + 2 conductores (BK/WH) creado correctamente.';
    ELSE
        PRINT 'FAIL 2: no se crearon los 2 conductores del par.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 2: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3
   CONDUCTOR.PAR_CONDUCTOR_ID APUNTANDO A UN PAR DE OTRO CABLE ->
   RECHAZADO (FK_conductor_par_mismo_cable)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @cable3a_id BIGINT, @cable3b_id BIGINT, @par3b_id BIGINT;
    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-3A', 2);
    SET @cable3a_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-3B', 2);
    SET @cable3b_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.par_conductor (proyecto_id, cable_id, numero_par) VALUES (@proyecto_id, @cable3b_id, 1);
    SET @par3b_id = SCOPE_IDENTITY();

    BEGIN TRY
        INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo, par_conductor_id)
        VALUES (@proyecto_id, @cable3a_id, N'1', @par3b_id);  -- par pertenece a @cable3b_id, no a @cable3a_id

        PRINT 'FAIL 3: se permitio un conductor con par_conductor_id de otro cable (deberia rechazarse).';
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER() = 547
            PRINT 'PASS 3: conductor con par de otro cable rechazado por FK_conductor_par_mismo_cable.';
        ELSE
        BEGIN
            PRINT 'FAIL 3: error inesperado (se esperaba 547).';
            PRINT ERROR_MESSAGE();
        END
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 3: se produjo un error inesperado a nivel de transaccion.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 4
   MISMO CODIGO DE CONDUCTOR DUPLICADO ACTIVO EN EL MISMO CABLE ->
   RECHAZADO (UX_conductor_cable_codigo)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @cable4_id BIGINT;
    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-4', 2);
    SET @cable4_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cable4_id, N'+');

    BEGIN TRY
        INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cable4_id, N'+');
        PRINT 'FAIL 4: se permitio un codigo de conductor duplicado activo en el mismo cable.';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 4: codigo de conductor duplicado activo rechazado (UX_conductor_cable_codigo).';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 4: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 5
   BLOQUE_TERMINAL XOR: CAJA SOLA -> PERMITIDO; GABINETE SOLO ->
   PERMITIDO; SIN DUEÑO -> RECHAZADO; DOS DUEÑOS -> RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @caja5_id BIGINT, @gabinete5_id BIGINT;
    INSERT INTO nucleo.caja (proyecto_id, tag_caja) VALUES (@proyecto_id, N'027-CAJA-5');
    SET @caja5_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-5', @tipo_gabinete_rio_id);
    SET @gabinete5_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.bloque_terminal (proyecto_id, caja_id, codigo) VALUES (@proyecto_id, @caja5_id, N'TB1');
    INSERT INTO nucleo.bloque_terminal (proyecto_id, gabinete_id, codigo) VALUES (@proyecto_id, @gabinete5_id, N'TB1');

    IF (SELECT COUNT(*) FROM nucleo.bloque_terminal WHERE proyecto_id = @proyecto_id AND codigo = N'TB1' AND (caja_id = @caja5_id OR gabinete_id = @gabinete5_id)) = 2
        PRINT 'PASS 5a: bloque_terminal de caja y de gabinete creados de forma independiente.';
    ELSE
        PRINT 'FAIL 5a: no se crearon ambos bloque_terminal.';

    BEGIN TRY
        INSERT INTO nucleo.bloque_terminal (proyecto_id, codigo) VALUES (@proyecto_id, N'SIN-DUENO');
        PRINT 'FAIL 5b: se permitio un bloque_terminal sin ningun dueño (deberia rechazar el XOR).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 5b: bloque_terminal sin dueño rechazado (CK_bloque_terminal_pertenencia_xor).';
    END CATCH;

    BEGIN TRY
        INSERT INTO nucleo.bloque_terminal (proyecto_id, caja_id, gabinete_id, codigo) VALUES (@proyecto_id, @caja5_id, @gabinete5_id, N'DOS-DUENOS');
        PRINT 'FAIL 5c: se permitio un bloque_terminal con dos dueños (deberia rechazar el XOR).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 5c: bloque_terminal con dos dueños rechazado (CK_bloque_terminal_pertenencia_xor).';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 5: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 6
   BLOQUE_TERMINAL CROSS-PROJECT -> RECHAZADO (FK compuesta)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @cliente6_id BIGINT, @proyecto6b_id BIGINT, @caja6b_id BIGINT;
    INSERT INTO nucleo.cliente (nombre, codigo_interno) VALUES (N'CLIENTE TEST 027', N'TEST-027-CROSS');
    SET @cliente6_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.proyecto (cliente_id, codigo_proyecto, nombre) VALUES (@cliente6_id, N'TEST-027-CROSS', N'Proyecto cruzado 027');
    SET @proyecto6b_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.caja (proyecto_id, tag_caja) VALUES (@proyecto6b_id, N'027-CAJA-6B');
    SET @caja6b_id = SCOPE_IDENTITY();

    BEGIN TRY
        -- caja6b_id pertenece a @proyecto6b_id, no a @proyecto_id (TEST-001)
        INSERT INTO nucleo.bloque_terminal (proyecto_id, caja_id, codigo) VALUES (@proyecto_id, @caja6b_id, N'CROSS');
        PRINT 'FAIL 6: se permitio un bloque_terminal referenciando una caja de otro proyecto.';
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER() = 547
            PRINT 'PASS 6: bloque_terminal cross-project rechazado por FK compuesta.';
        ELSE
        BEGIN
            PRINT 'FAIL 6: error inesperado (se esperaba 547).';
            PRINT ERROR_MESSAGE();
        END
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 6: se produjo un error inesperado a nivel de transaccion.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 7
   TERMINAL + POSICIONES: BORNERA "F1-2" -> DOS TERMINALES (F1, F2)
   INDEPENDIENTES, CADA UNO CON SU PROPIA POSICION; CODIGO DE
   POSICION DUPLICADO EN EL MISMO TERMINAL -> RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @caja7_id BIGINT, @bloque7_id BIGINT, @termF1_id BIGINT, @termF2_id BIGINT;
    INSERT INTO nucleo.caja (proyecto_id, tag_caja) VALUES (@proyecto_id, N'027-CAJA-7');
    SET @caja7_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.bloque_terminal (proyecto_id, caja_id, codigo) VALUES (@proyecto_id, @caja7_id, N'TB1');
    SET @bloque7_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloque7_id, N'F1');
    SET @termF1_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloque7_id, N'F2');
    SET @termF2_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo) VALUES (@proyecto_id, @termF1_id, N'A');

    IF (SELECT COUNT(*) FROM nucleo.terminal WHERE bloque_terminal_id = @bloque7_id AND activo = 1) = 2
        PRINT 'PASS 7a: BORNERA "F1-2" representada como 2 terminales independientes (F1, F2).';
    ELSE
        PRINT 'FAIL 7a: no se crearon los 2 terminales.';

    BEGIN TRY
        INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo) VALUES (@proyecto_id, @termF1_id, N'A');
        PRINT 'FAIL 7b: se permitio un codigo de posicion duplicado activo en el mismo terminal.';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 7b: codigo de posicion duplicado rechazado (UX_posicion_terminal_terminal_codigo).';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 7: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 8
   TERMINAL DUPLICADO (NUMERO MANUAL) EN EL MISMO BLOQUE ->
   RECHAZADO (UX_terminal_bloque_numero)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @caja8_id BIGINT, @bloque8_id BIGINT;
    INSERT INTO nucleo.caja (proyecto_id, tag_caja) VALUES (@proyecto_id, N'027-CAJA-8');
    SET @caja8_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.bloque_terminal (proyecto_id, caja_id, codigo) VALUES (@proyecto_id, @caja8_id, N'TB1');
    SET @bloque8_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloque8_id, N'15');

    BEGIN TRY
        INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloque8_id, N'15');
        PRINT 'FAIL 8: se permitio un terminal manual duplicado (mismo numero) en el mismo bloque.';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 8: terminal manual duplicado rechazado (UX_terminal_bloque_numero).';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 8: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 9
   MATERIALIZACION AUTOMATICA DE TERMINALES DE MODULO (catalogo
   RTD4): bloque_terminal 'MODULO' + 4 terminales (3 del canal 0,
   incluyendo las 2 etiquetas iguales "IN_0/A" del caso RTD real,
   1 del canal 1) + 1 posicion 'A' cada uno. Idempotencia via
   sp_sincronizar_terminales_modulo (no duplica al re-ejecutar).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @gabinete9_id BIGINT, @rack9_id BIGINT, @slot9_id BIGINT, @modulo9_id BIGINT, @bloqueMod9_id BIGINT;
    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-9', @tipo_gabinete_rio_id);
    SET @gabinete9_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack) VALUES (@proyecto_id, @gabinete9_id, 1);
    SET @rack9_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot) VALUES (@proyecto_id, @rack9_id, 1);
    SET @slot9_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id) VALUES (@proyecto_id, @slot9_id, @catalogo_rtd_id);
    SET @modulo9_id = SCOPE_IDENTITY();

    SELECT @bloqueMod9_id = id FROM nucleo.bloque_terminal WHERE modulo_id = @modulo9_id AND activo = 1;

    IF @bloqueMod9_id IS NOT NULL
       AND (SELECT COUNT(*) FROM nucleo.terminal WHERE bloque_terminal_id = @bloqueMod9_id AND activo = 1) = 4
       AND (SELECT COUNT(*) FROM nucleo.terminal WHERE bloque_terminal_id = @bloqueMod9_id AND numero = N'IN_0/A' AND activo = 1) = 2
       AND (SELECT COUNT(*) FROM nucleo.posicion_terminal pt JOIN nucleo.terminal t ON t.id = pt.terminal_id WHERE t.bloque_terminal_id = @bloqueMod9_id AND pt.activo = 1) = 4
        PRINT 'PASS 9a: modulo RTD4 materializo 1 bloque_terminal + 4 terminales (2 con etiqueta "IN_0/A") + 4 posiciones.';
    ELSE
        PRINT 'FAIL 9a: la materializacion automatica del modulo no genero la estructura esperada.';

    EXEC nucleo.sp_sincronizar_terminales_modulo @modulo_id = @modulo9_id;

    IF (SELECT COUNT(*) FROM nucleo.terminal WHERE bloque_terminal_id = @bloqueMod9_id AND activo = 1) = 4
       AND (SELECT COUNT(*) FROM nucleo.bloque_terminal WHERE modulo_id = @modulo9_id AND activo = 1) = 1
        PRINT 'PASS 9b: sp_sincronizar_terminales_modulo es idempotente (no duplica al re-ejecutar).';
    ELSE
        PRINT 'FAIL 9b: la re-ejecucion del procedimiento duplico filas.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 9: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 10
   SINCRONIZACION: AGREGAR UNA FILA NUEVA A cat.cat_modulo_io_terminal
   DESPUES DE INSTALAR EL MODULO -> sp_sincronizar_terminales_modulo
   MATERIALIZA SOLO EL TERMINAL FALTANTE, SIN TOCAR LOS EXISTENTES
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @catalogo10_id BIGINT, @gabinete10_id BIGINT, @rack10_id BIGINT, @slot10_id BIGINT, @modulo10_id BIGINT, @bloque10_id BIGINT;
    INSERT INTO cat.cat_modulo_io (fabricante, modelo, tipo_io_id, canales_max)
    VALUES (N'SIEI TEST', N'TEST-027-SYNC', @tipo_ai_id, 1);
    SET @catalogo10_id = SCOPE_IDENTITY();

    INSERT INTO cat.cat_modulo_io_terminal (catalogo_modulo_id, numero_canal, orden_terminal, etiqueta_terminal)
    VALUES (@catalogo10_id, 0, 1, N'Y0');

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-10', @tipo_gabinete_rio_id);
    SET @gabinete10_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack) VALUES (@proyecto_id, @gabinete10_id, 1);
    SET @rack10_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot) VALUES (@proyecto_id, @rack10_id, 1);
    SET @slot10_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id) VALUES (@proyecto_id, @slot10_id, @catalogo10_id);
    SET @modulo10_id = SCOPE_IDENTITY();

    SELECT @bloque10_id = id FROM nucleo.bloque_terminal WHERE modulo_id = @modulo10_id AND activo = 1;

    -- Catalogo crece DESPUES de instalar el modulo — no dispara ningun
    -- trigger de nucleo.modulo (esa tabla no cambio).
    INSERT INTO cat.cat_modulo_io_terminal (catalogo_modulo_id, numero_canal, orden_terminal, etiqueta_terminal)
    VALUES (@catalogo10_id, 0, 2, N'Y0-SPARE');

    IF (SELECT COUNT(*) FROM nucleo.terminal WHERE bloque_terminal_id = @bloque10_id AND activo = 1) = 1
        PRINT 'PASS 10a: agregar una fila de catalogo despues de instalar el modulo NO materializa nada por si sola.';
    ELSE
        PRINT 'FAIL 10a: el terminal nuevo aparecio sin invocar la sincronizacion.';

    EXEC nucleo.sp_sincronizar_terminales_modulo @modulo_id = @modulo10_id;

    IF (SELECT COUNT(*) FROM nucleo.terminal WHERE bloque_terminal_id = @bloque10_id AND activo = 1) = 2
       AND EXISTS (SELECT 1 FROM nucleo.terminal WHERE bloque_terminal_id = @bloque10_id AND numero = N'Y0' AND activo = 1)
       AND EXISTS (SELECT 1 FROM nucleo.terminal WHERE bloque_terminal_id = @bloque10_id AND numero = N'Y0-SPARE' AND activo = 1)
        PRINT 'PASS 10b: sp_sincronizar_terminales_modulo materializo solo el terminal faltante.';
    ELSE
        PRINT 'FAIL 10b: la sincronizacion no genero exactamente el terminal faltante.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 10: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 11
   TERMINAL DE CATALOGO PERTENECIENTE A UN catalogo_modulo_id
   DISTINTO DEL MODULO INSTALADO -> RECHAZADO
   (TR_terminal_validar_catalogo_modulo)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @gabinete11_id BIGINT, @rack11_id BIGINT, @slot11_id BIGINT, @modulo11_id BIGINT, @bloque11_id BIGINT;
    DECLARE @cmit_otro_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-11', @tipo_gabinete_rio_id);
    SET @gabinete11_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack) VALUES (@proyecto_id, @gabinete11_id, 1);
    SET @rack11_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot) VALUES (@proyecto_id, @rack11_id, 1);
    SET @slot11_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id) VALUES (@proyecto_id, @slot11_id, @catalogo_rtd_id);
    SET @modulo11_id = SCOPE_IDENTITY();

    SELECT @bloque11_id = id FROM nucleo.bloque_terminal WHERE modulo_id = @modulo11_id AND activo = 1;
    SELECT @cmit_otro_id = id FROM cat.cat_modulo_io_terminal WHERE catalogo_modulo_id = @catalogo_simple2_id AND numero_canal = 0;

    -- @cmit_otro_id pertenece a @catalogo_simple2_id, no a @catalogo_rtd_id
    -- (el catalogo real del modulo) — TR_terminal_validar_catalogo_modulo
    -- hace su propio ROLLBACK TRANSACTION al rechazar, por eso esta
    -- insercion va directa en el TRY exterior (no anidada) y no hay un
    -- ROLLBACK explicito despues de ella: lo maneja el CATCH exterior.
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero, catalogo_modulo_io_terminal_id)
    VALUES (@proyecto_id, @bloque11_id, N'X0-INTRUSO', @cmit_otro_id);

    PRINT 'FAIL 11: se permitio materializar un terminal de un catalogo_modulo_id distinto al del modulo instalado.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51026
        PRINT 'PASS 11: terminal de catalogo ajeno rechazado (TR_terminal_validar_catalogo_modulo).';
    ELSE
    BEGIN
        PRINT 'FAIL 11: error inesperado (se esperaba 51026).';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 12
   CAMBIO DE CATALOGO DEL MODULO SIN OCUPACION -> PERMITIDO;
   TERMINALES VIEJOS DESACTIVADOS, NUEVOS CREADOS
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @gabinete12_id BIGINT, @rack12_id BIGINT, @slot12_id BIGINT, @modulo12_id BIGINT, @bloque12_id BIGINT;
    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-12', @tipo_gabinete_rio_id);
    SET @gabinete12_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack) VALUES (@proyecto_id, @gabinete12_id, 1);
    SET @rack12_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot) VALUES (@proyecto_id, @rack12_id, 1);
    SET @slot12_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id) VALUES (@proyecto_id, @slot12_id, @catalogo_rtd_id);
    SET @modulo12_id = SCOPE_IDENTITY();

    SELECT @bloque12_id = id FROM nucleo.bloque_terminal WHERE modulo_id = @modulo12_id AND activo = 1;

    UPDATE nucleo.modulo SET catalogo_modulo_id = @catalogo_simple2_id WHERE id = @modulo12_id;

    IF (SELECT COUNT(*) FROM nucleo.terminal WHERE bloque_terminal_id = @bloque12_id AND activo = 1) = 2
       AND EXISTS (SELECT 1 FROM nucleo.terminal WHERE bloque_terminal_id = @bloque12_id AND numero = N'X0' AND activo = 1)
       AND (SELECT COUNT(*) FROM nucleo.terminal WHERE bloque_terminal_id = @bloque12_id AND numero = N'IN_0/A' AND activo = 1) = 0
        PRINT 'PASS 12: cambio de catalogo sin ocupacion desactivo los terminales viejos y creo los nuevos.';
    ELSE
        PRINT 'FAIL 12: el cambio de catalogo no dejo el bloque en el estado esperado.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 12: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   NOTA DE ESTILO (igual que 025_smoke_senales_opcionales.sql):
   varios de los triggers nuevos de 015 hacen su propio ROLLBACK
   TRANSACTION antes de THROW cuando rechazan una fila — eso
   termina la transaccion COMPLETA (no solo el bloque TRY anidado
   donde ocurrio), sin importar cuantos niveles de BEGIN TRY haya.
   Por eso cada assertion que dispara deliberadamente uno de esos
   rechazos vive en su PROPIO BEGIN TRY/BEGIN TRANSACTION de nivel
   superior, con su propio fixture minimo — nunca encadenada junto
   a otra assertion de rechazo dentro de la misma transaccion.
   ============================================================ */


/* ============================================================
   Fixture compartida para los casos 13-16a/18/20 (ruta fisica
   completa) — ninguna de estas assertions dispara un ROLLBACK
   de trigger (14 es un indice unico filtrado comun; 16a/18 son
   inserciones validas; 20 es una cascada, no un rechazo), asi
   que pueden compartir una sola transaccion con seguridad.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @gabineteR_id BIGINT, @rackR_id BIGINT, @slotR_id BIGINT, @moduloR_id BIGINT, @canal0_id BIGINT, @canal1_id BIGINT;
    DECLARE @cajaR_id BIGINT, @cajaR2_id BIGINT, @instrumentoR_id BIGINT, @senalR_id BIGINT, @senalR2_id BIGINT;
    DECLARE @puntoInst_id BIGINT, @puntoCaja_id BIGINT, @puntoMod0_id BIGINT, @puntoMod1_id BIGINT, @puntoCaja2_id BIGINT;
    DECLARE @rutaR_id BIGINT, @tramo1_id BIGINT, @tramo2_id BIGINT;
    DECLARE @cableR_id BIGINT, @condR1_id BIGINT, @condR2_id BIGINT, @condR3_id BIGINT;
    DECLARE @bloqueCajaR_id BIGINT, @bloqueModR_id BIGINT, @termCajaA_id BIGINT, @termCajaB_id BIGINT, @termCajaC_id BIGINT;
    DECLARE @posCajaA_id BIGINT, @posCajaB_id BIGINT, @posCajaC_id BIGINT, @termMod0_id BIGINT, @posMod0_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-R', @tipo_gabinete_rio_id);
    SET @gabineteR_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack) VALUES (@proyecto_id, @gabineteR_id, 1);
    SET @rackR_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot) VALUES (@proyecto_id, @rackR_id, 1);
    SET @slotR_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id) VALUES (@proyecto_id, @slotR_id, @catalogo_simple2_id);
    SET @moduloR_id = SCOPE_IDENTITY();
    SELECT @canal0_id = id FROM nucleo.canal WHERE modulo_id = @moduloR_id AND numero_canal = 0;
    SELECT @canal1_id = id FROM nucleo.canal WHERE modulo_id = @moduloR_id AND numero_canal = 1;
    SELECT @bloqueModR_id = id FROM nucleo.bloque_terminal WHERE modulo_id = @moduloR_id AND activo = 1;
    SELECT @termMod0_id = t.id FROM nucleo.terminal t JOIN cat.cat_modulo_io_terminal cmit ON cmit.id = t.catalogo_modulo_io_terminal_id
        WHERE t.bloque_terminal_id = @bloqueModR_id AND cmit.numero_canal = 0;
    SELECT @posMod0_id = id FROM nucleo.posicion_terminal WHERE terminal_id = @termMod0_id AND activo = 1;

    INSERT INTO nucleo.caja (proyecto_id, tag_caja) VALUES (@proyecto_id, N'027-CAJA-R');
    SET @cajaR_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.caja (proyecto_id, tag_caja) VALUES (@proyecto_id, N'027-CAJA-R2');
    SET @cajaR2_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0001');
    SET @instrumentoR_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tipo_io_id, canal_id, tag_senal)
    VALUES (@proyecto_id, @instrumentoR_id, @clase_control_id, @tipo_ai_id, @canal0_id, N'027-HV-0001_REM');
    SET @senalR_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tipo_io_id, canal_id, tag_senal)
    VALUES (@proyecto_id, @instrumentoR_id, @clase_control_id, @tipo_ai_id, @canal1_id, N'027-HV-0001_ZIO');
    SET @senalR2_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @instrumentoR_id);
    SET @puntoInst_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, caja_id) VALUES (@proyecto_id, @cajaR_id);
    SET @puntoCaja_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, caja_id) VALUES (@proyecto_id, @cajaR2_id);
    SET @puntoCaja2_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, modulo_id) VALUES (@proyecto_id, @moduloR_id);
    SET @puntoMod0_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senalR_id);
    SET @rutaR_id = SCOPE_IDENTITY();

    -- 2 tramos: INSTRUMENTO -> CAJA -> MODULO, con par_conductor_id NULL
    -- (modelo nuevo) — un unico INSERT multi-fila, igual que hace el backend.
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden) VALUES
        (@proyecto_id, @rutaR_id, NULL, @puntoInst_id, @puntoCaja_id, 1),
        (@proyecto_id, @rutaR_id, NULL, @puntoCaja_id, @puntoMod0_id, 2);

    SELECT @tramo1_id = id FROM nucleo.tramo_conexion WHERE ruta_conexion_id = @rutaR_id AND numero_orden = 1;
    SELECT @tramo2_id = id FROM nucleo.tramo_conexion WHERE ruta_conexion_id = @rutaR_id AND numero_orden = 2;

    IF @tramo1_id IS NOT NULL AND @tramo2_id IS NOT NULL
        PRINT 'PASS 13: tramo del modelo nuevo (par_conductor_id NULL) creado y validado por TR_tramo_conexion_validar_secuencia.';
    ELSE
        PRINT 'FAIL 13: no se crearon los 2 tramos del modelo nuevo.';

    -- Cable + 3 conductores (estilo HYO), bloque/terminales de la caja
    INSERT INTO nucleo.cable (proyecto_id, tag_cable, tipo_cable, capacidad_conductores)
    VALUES (@proyecto_id, N'027-CABLE-R', N'1-19c#14 AWG', 19);
    SET @cableR_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cableR_id, N'1');
    SET @condR1_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cableR_id, N'2');
    SET @condR2_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cableR_id, N'3');
    SET @condR3_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.bloque_terminal (proyecto_id, caja_id, codigo) VALUES (@proyecto_id, @cajaR_id, N'TBC');
    SET @bloqueCajaR_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloqueCajaR_id, N'1');
    SET @termCajaA_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloqueCajaR_id, N'2');
    SET @termCajaB_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloqueCajaR_id, N'3');
    SET @termCajaC_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo) VALUES (@proyecto_id, @termCajaA_id, N'A');
    SET @posCajaA_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo) VALUES (@proyecto_id, @termCajaB_id, N'A');
    SET @posCajaB_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo) VALUES (@proyecto_id, @termCajaC_id, N'A');
    SET @posCajaC_id = SCOPE_IDENTITY();

    /* --------------------------------------------------------
       CASO 14 — TRAMO_CONDUCTOR: exclusividad fisica de conductor
       -------------------------------------------------------- */

    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo1_id, @condR1_id);
    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo1_id, @condR2_id);
    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo1_id, @condR3_id);

    BEGIN TRY
        -- @condR1_id ya esta en un tramo_conductor activo (tramo1) — intentar
        -- reutilizarlo en tramo2 debe rechazarse.
        INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo2_id, @condR1_id);
        PRINT 'FAIL 14: se permitio el mismo conductor en dos TRAMO_CONDUCTOR activos.';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 14: exclusividad de conductor respetada (UX_tramo_conductor_conductor_exclusivo).';
    END CATCH;

    /* --------------------------------------------------------
       CASO 15 — HYO-style: 3 conductores, 3 tramo_conductor, 3
       terminaciones ORIGEN sin conflicto (multi-conductor real)
       -------------------------------------------------------- */

    DECLARE @tc1_id BIGINT, @tc2_id BIGINT, @tc3_id BIGINT;
    SELECT @tc1_id = id FROM nucleo.tramo_conductor WHERE tramo_conexion_id = @tramo1_id AND conductor_id = @condR1_id;
    SELECT @tc2_id = id FROM nucleo.tramo_conductor WHERE tramo_conexion_id = @tramo1_id AND conductor_id = @condR2_id;
    SELECT @tc3_id = id FROM nucleo.tramo_conductor WHERE tramo_conexion_id = @tramo1_id AND conductor_id = @condR3_id;

    INSERT INTO nucleo.terminacion (proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo) VALUES
        (@proyecto_id, @tc1_id, @posCajaA_id, N'DESTINO'),
        (@proyecto_id, @tc2_id, @posCajaB_id, N'DESTINO'),
        (@proyecto_id, @tc3_id, @posCajaC_id, N'DESTINO');

    IF (SELECT COUNT(*) FROM nucleo.terminacion WHERE tramo_conductor_id IN (@tc1_id, @tc2_id, @tc3_id) AND activo = 1) = 3
        PRINT 'PASS 15: caso HYO (3 conductores, 3 terminaciones DESTINO en 3 posiciones distintas) sin conflicto.';
    ELSE
        PRINT 'FAIL 15: no se crearon las 3 terminaciones esperadas.';

    /* --------------------------------------------------------
       CASO 16 — propietario correcto (DESTINO de tramo1 = caja
       @cajaR_id, terminacion apunta a un terminal de esa misma
       caja) -> ya validado por el paso anterior (16 confirma
       explicitamente que el trigger no rechazo nada). Propietario
       INCORRECTO: crear un terminal en @cajaR2_id (otra caja) e
       intentar usarlo como DESTINO del mismo tramo1 -> rechazado.
       -------------------------------------------------------- */

    IF EXISTS (SELECT 1 FROM nucleo.terminacion WHERE tramo_conductor_id = @tc1_id AND activo = 1)
        PRINT 'PASS 16a: terminacion con propietario correcto (misma caja del punto_destino) aceptada.';
    ELSE
        PRINT 'FAIL 16a: la terminacion de propietario correcto no quedo activa.';

    -- 16b (cross-owner), 17 (extremo instrumento) y 19 (canal de modulo
    -- incorrecto) viven en transacciones propias mas abajo — encadenarlas
    -- aqui haria que el ROLLBACK interno del trigger, al rechazar la
    -- primera, terminara esta transaccion compartida antes de llegar a 18/20.

    /* --------------------------------------------------------
       CASO 18 — terminal de modulo, canal correcto -> permitido
       -------------------------------------------------------- */

    DECLARE @condR5_id BIGINT, @tc6_id BIGINT;
    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cableR_id, N'5');
    SET @condR5_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo2_id, @condR5_id);
    SET @tc6_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.terminacion (proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo)
    VALUES (@proyecto_id, @tc6_id, @posMod0_id, N'DESTINO');

    IF EXISTS (SELECT 1 FROM nucleo.terminacion WHERE tramo_conductor_id = @tc6_id AND activo = 1)
        PRINT 'PASS 18: terminacion en terminal de modulo con canal correcto (canal 0 = señal del canal 0) aceptada.';
    ELSE
        PRINT 'FAIL 18: la terminacion de canal correcto no quedo activa.';

    /* --------------------------------------------------------
       CASO 20 — cascada logica: desactivar la RUTA_CONEXION completa
       cascada hasta TERMINACION (ruta -> tramo_conexion, ya existente
       desde 001, -> tramo_conductor -> terminacion, nuevo en 015).
       Deliberadamente se desactiva la ruta entera, no un tramo suelto:
       desactivar solo el tramo intermedio dejaria el tramo2 activo con
       numero_orden discontinuo, un estado que
       TR_tramo_conexion_validar_secuencia ya rechazaba desde antes de
       015 (error 51004) — no es un caso valido de prueba de cascada.
       -------------------------------------------------------- */

    UPDATE nucleo.ruta_conexion SET activo = 0 WHERE id = @rutaR_id;

    IF (SELECT COUNT(*) FROM nucleo.tramo_conexion WHERE ruta_conexion_id = @rutaR_id AND activo = 1) = 0
       AND (SELECT COUNT(*) FROM nucleo.tramo_conductor WHERE tramo_conexion_id IN (@tramo1_id, @tramo2_id) AND activo = 1) = 0
       AND (SELECT COUNT(*) FROM nucleo.terminacion WHERE tramo_conductor_id IN (@tc1_id, @tc2_id, @tc3_id, @tc6_id) AND activo = 1) = 0
        PRINT 'PASS 20: cascada ruta_conexion -> tramo_conexion -> tramo_conductor -> terminacion funciona correctamente.';
    ELSE
        PRINT 'FAIL 20: la cascada de desactivacion no llego hasta terminacion.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 13-20: se produjo un error inesperado en la fixture compartida.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 16b (aislado)
   PROPIETARIO INCORRECTO: terminacion cuyo bloque_terminal
   pertenece a un GABINETE distinto del punto_destino real del
   tramo -> RECHAZADO. Fixture minima propia (instrumento ->
   gabinete A, un segundo gabinete B ajeno).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @gabA16_id BIGINT, @gabB16_id BIGINT, @inst16_id BIGINT, @senal16_id BIGINT;
    DECLARE @puntoI16_id BIGINT, @puntoA16_id BIGINT, @ruta16_id BIGINT, @tramo16_id BIGINT;
    DECLARE @cable16_id BIGINT, @cond16_id BIGINT, @tc16_id BIGINT;
    DECLARE @bloqueB16_id BIGINT, @termB16_id BIGINT, @posB16_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-16A', @tipo_gabinete_rio_id);
    SET @gabA16_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-16B', @tipo_gabinete_rio_id);
    SET @gabB16_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0016');
    SET @inst16_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto_id, @inst16_id, @clase_control_id, N'027-HV-0016_HY');
    SET @senal16_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst16_id);
    SET @puntoI16_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gabA16_id);
    SET @puntoA16_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal16_id);
    SET @ruta16_id = SCOPE_IDENTITY();
    -- tramo unico: INSTRUMENTO -> GABINETE A (destino real)
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden)
    VALUES (@proyecto_id, @ruta16_id, NULL, @puntoI16_id, @puntoA16_id, 1);
    SET @tramo16_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-16', 2);
    SET @cable16_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cable16_id, N'1');
    SET @cond16_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo16_id, @cond16_id);
    SET @tc16_id = SCOPE_IDENTITY();

    -- Terminal creado en GABINETE B (ajeno al tramo, cuyo destino real es A)
    INSERT INTO nucleo.bloque_terminal (proyecto_id, gabinete_id, codigo) VALUES (@proyecto_id, @gabB16_id, N'TB1');
    SET @bloqueB16_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloqueB16_id, N'1');
    SET @termB16_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo) VALUES (@proyecto_id, @termB16_id, N'A');
    SET @posB16_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.terminacion (proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo)
    VALUES (@proyecto_id, @tc16_id, @posB16_id, N'DESTINO');
    PRINT 'FAIL 16b: se permitio una terminacion cuyo bloque_terminal pertenece a un gabinete distinto del punto_destino real.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51024
        PRINT 'PASS 16b: terminacion cross-owner (gabinete distinto) rechazada (TR_terminacion_validar_propietario_y_canal).';
    ELSE
    BEGIN
        PRINT 'FAIL 16b: error inesperado (se esperaba 51024).';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 17 (aislado)
   EXTREMO INSTRUMENTO/EQUIPO: ninguna terminacion valida existe
   para un extremo cuyo punto_conexion es instrumento -> RECHAZADO
   (bloque_terminal no modela instrumento/equipo en 015).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @gab17_id BIGINT, @inst17_id BIGINT, @senal17_id BIGINT;
    DECLARE @puntoI17_id BIGINT, @puntoG17_id BIGINT, @ruta17_id BIGINT, @tramo17_id BIGINT;
    DECLARE @cable17_id BIGINT, @cond17_id BIGINT, @tc17_id BIGINT;
    DECLARE @bloque17_id BIGINT, @term17_id BIGINT, @pos17_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-17', @tipo_gabinete_rio_id);
    SET @gab17_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0017');
    SET @inst17_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto_id, @inst17_id, @clase_control_id, N'027-HV-0017_HY');
    SET @senal17_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst17_id);
    SET @puntoI17_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gab17_id);
    SET @puntoG17_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal17_id);
    SET @ruta17_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden)
    VALUES (@proyecto_id, @ruta17_id, NULL, @puntoI17_id, @puntoG17_id, 1);
    SET @tramo17_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-17', 2);
    SET @cable17_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cable17_id, N'1');
    SET @cond17_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo17_id, @cond17_id);
    SET @tc17_id = SCOPE_IDENTITY();

    -- Terminal real del propio gabinete destino — el problema no es el
    -- terminal, es que se intenta usarlo para el extremo ORIGEN, cuyo
    -- punto_conexion es el INSTRUMENTO.
    INSERT INTO nucleo.bloque_terminal (proyecto_id, gabinete_id, codigo) VALUES (@proyecto_id, @gab17_id, N'TB1');
    SET @bloque17_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloque17_id, N'1');
    SET @term17_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo) VALUES (@proyecto_id, @term17_id, N'A');
    SET @pos17_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.terminacion (proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo)
    VALUES (@proyecto_id, @tc17_id, @pos17_id, N'ORIGEN');
    PRINT 'FAIL 17: se permitio una terminacion en el extremo instrumento/equipo (fuera de alcance en 015).';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51024
        PRINT 'PASS 17: terminacion en extremo instrumento rechazada (bloque_terminal no modela instrumento en 015).';
    ELSE
    BEGIN
        PRINT 'FAIL 17: error inesperado (se esperaba 51024).';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 19 (aislado)
   TERMINAL DE MODULO, CANAL INCORRECTO: la señal de la ruta esta
   en el canal 0, la terminacion intenta usar el terminal
   materializado del canal 1 del MISMO modulo -> RECHAZADO.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @gab19_id BIGINT, @rack19_id BIGINT, @slot19_id BIGINT, @mod19_id BIGINT, @canal19_0_id BIGINT;
    DECLARE @caja19_id BIGINT, @inst19_id BIGINT, @senal19_id BIGINT;
    DECLARE @puntoI19_id BIGINT, @puntoC19_id BIGINT, @puntoM19_id BIGINT, @ruta19_id BIGINT, @tramo19b_id BIGINT;
    DECLARE @cable19_id BIGINT, @cond19_id BIGINT, @tc19_id BIGINT;
    DECLARE @bloqueMod19_id BIGINT, @term19_1_id BIGINT, @pos19_1_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-19', @tipo_gabinete_rio_id);
    SET @gab19_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack) VALUES (@proyecto_id, @gab19_id, 1);
    SET @rack19_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot) VALUES (@proyecto_id, @rack19_id, 1);
    SET @slot19_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id) VALUES (@proyecto_id, @slot19_id, @catalogo_simple2_id);
    SET @mod19_id = SCOPE_IDENTITY();
    SELECT @canal19_0_id = id FROM nucleo.canal WHERE modulo_id = @mod19_id AND numero_canal = 0;
    SELECT @bloqueMod19_id = id FROM nucleo.bloque_terminal WHERE modulo_id = @mod19_id AND activo = 1;
    SELECT @term19_1_id = t.id FROM nucleo.terminal t JOIN cat.cat_modulo_io_terminal cmit ON cmit.id = t.catalogo_modulo_io_terminal_id
        WHERE t.bloque_terminal_id = @bloqueMod19_id AND cmit.numero_canal = 1;
    SELECT @pos19_1_id = id FROM nucleo.posicion_terminal WHERE terminal_id = @term19_1_id AND activo = 1;

    INSERT INTO nucleo.caja (proyecto_id, tag_caja) VALUES (@proyecto_id, N'027-CAJA-19');
    SET @caja19_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0019');
    SET @inst19_id = SCOPE_IDENTITY();
    -- la señal esta explicitamente en el canal 0
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tipo_io_id, canal_id, tag_senal)
    VALUES (@proyecto_id, @inst19_id, @clase_control_id, @tipo_ai_id, @canal19_0_id, N'027-HV-0019_HY');
    SET @senal19_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst19_id);
    SET @puntoI19_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, caja_id) VALUES (@proyecto_id, @caja19_id);
    SET @puntoC19_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, modulo_id) VALUES (@proyecto_id, @mod19_id);
    SET @puntoM19_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal19_id);
    SET @ruta19_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden) VALUES
        (@proyecto_id, @ruta19_id, NULL, @puntoI19_id, @puntoC19_id, 1),
        (@proyecto_id, @ruta19_id, NULL, @puntoC19_id, @puntoM19_id, 2);
    SELECT @tramo19b_id = id FROM nucleo.tramo_conexion WHERE ruta_conexion_id = @ruta19_id AND numero_orden = 2;

    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-19', 2);
    SET @cable19_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cable19_id, N'1');
    SET @cond19_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo19b_id, @cond19_id);
    SET @tc19_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.terminacion (proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo)
    VALUES (@proyecto_id, @tc19_id, @pos19_1_id, N'DESTINO');
    PRINT 'FAIL 19: se permitio una terminacion en el terminal del canal 1 para una señal del canal 0.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51025
        PRINT 'PASS 19: terminacion en canal de modulo incorrecto rechazada (TR_terminacion_validar_propietario_y_canal).';
    ELSE
    BEGIN
        PRINT 'FAIL 19: error inesperado (se esperaba 51025).';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASOS 21-25 (cada uno aislado en su propia transaccion, con su
   propio fixture minimo: instrumento -> gabinete, un conductor
   ocupado por una terminacion) — BLOQUEO POR USO: cada recurso
   (conductor / posicion_terminal / terminal / bloque_terminal /
   cable via camino nuevo) rechaza su propia desactivacion.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @gab21_id BIGINT, @inst21_id BIGINT, @senal21_id BIGINT, @puntoI21_id BIGINT, @puntoG21_id BIGINT;
    DECLARE @ruta21_id BIGINT, @tramo21_id BIGINT, @cable21_id BIGINT, @cond21_id BIGINT, @tc21_id BIGINT;
    DECLARE @bloque21_id BIGINT, @term21_id BIGINT, @pos21_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-21', @tipo_gabinete_rio_id); SET @gab21_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0021'); SET @inst21_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto_id, @inst21_id, @clase_control_id, N'027-HV-0021_HY'); SET @senal21_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst21_id); SET @puntoI21_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gab21_id); SET @puntoG21_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal21_id); SET @ruta21_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden)
        VALUES (@proyecto_id, @ruta21_id, NULL, @puntoI21_id, @puntoG21_id, 1);
    SET @tramo21_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-21', 2); SET @cable21_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cable21_id, N'1'); SET @cond21_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo21_id, @cond21_id); SET @tc21_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.bloque_terminal (proyecto_id, gabinete_id, codigo) VALUES (@proyecto_id, @gab21_id, N'TB1'); SET @bloque21_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloque21_id, N'1'); SET @term21_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo) VALUES (@proyecto_id, @term21_id, N'A'); SET @pos21_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminacion (proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo) VALUES (@proyecto_id, @tc21_id, @pos21_id, N'DESTINO');

    UPDATE nucleo.conductor SET activo = 0 WHERE id = @cond21_id;
    PRINT 'FAIL 21: se permitio desactivar un CONDUCTOR en uso.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51028 PRINT 'PASS 21: desactivacion de CONDUCTOR en uso rechazada.';
    ELSE BEGIN PRINT 'FAIL 21: error inesperado (se esperaba 51028).'; PRINT ERROR_MESSAGE(); END
END CATCH;


BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @gab22_id BIGINT, @inst22_id BIGINT, @senal22_id BIGINT, @puntoI22_id BIGINT, @puntoG22_id BIGINT;
    DECLARE @ruta22z_id BIGINT, @tramo22_id BIGINT, @cable22z_id BIGINT, @cond22_id BIGINT, @tc22_id BIGINT;
    DECLARE @bloque22_id BIGINT, @term22_id BIGINT, @pos22_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-22Z', @tipo_gabinete_rio_id); SET @gab22_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0022Z'); SET @inst22_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto_id, @inst22_id, @clase_control_id, N'027-HV-0022Z_HY'); SET @senal22_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst22_id); SET @puntoI22_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gab22_id); SET @puntoG22_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal22_id); SET @ruta22z_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden)
        VALUES (@proyecto_id, @ruta22z_id, NULL, @puntoI22_id, @puntoG22_id, 1);
    SET @tramo22_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-22Z', 2); SET @cable22z_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cable22z_id, N'1'); SET @cond22_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo22_id, @cond22_id); SET @tc22_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.bloque_terminal (proyecto_id, gabinete_id, codigo) VALUES (@proyecto_id, @gab22_id, N'TB1'); SET @bloque22_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloque22_id, N'1'); SET @term22_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo) VALUES (@proyecto_id, @term22_id, N'A'); SET @pos22_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminacion (proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo) VALUES (@proyecto_id, @tc22_id, @pos22_id, N'DESTINO');

    UPDATE nucleo.posicion_terminal SET activo = 0 WHERE id = @pos22_id;
    PRINT 'FAIL 22: se permitio desactivar una POSICION_TERMINAL ocupada.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51029 PRINT 'PASS 22: desactivacion de POSICION_TERMINAL ocupada rechazada.';
    ELSE BEGIN PRINT 'FAIL 22: error inesperado (se esperaba 51029).'; PRINT ERROR_MESSAGE(); END
END CATCH;


BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @gab23_id BIGINT, @inst23_id BIGINT, @senal23_id BIGINT, @puntoI23_id BIGINT, @puntoG23_id BIGINT;
    DECLARE @ruta23_id BIGINT, @tramo23_id BIGINT, @cable23z_id BIGINT, @cond23z_id BIGINT, @tc23_id BIGINT;
    DECLARE @bloque23z_id BIGINT, @term23_id BIGINT, @pos23_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-23', @tipo_gabinete_rio_id); SET @gab23_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0023'); SET @inst23_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto_id, @inst23_id, @clase_control_id, N'027-HV-0023_HY'); SET @senal23_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst23_id); SET @puntoI23_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gab23_id); SET @puntoG23_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal23_id); SET @ruta23_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden)
        VALUES (@proyecto_id, @ruta23_id, NULL, @puntoI23_id, @puntoG23_id, 1);
    SET @tramo23_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-23Z', 2); SET @cable23z_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cable23z_id, N'1'); SET @cond23z_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo23_id, @cond23z_id); SET @tc23_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.bloque_terminal (proyecto_id, gabinete_id, codigo) VALUES (@proyecto_id, @gab23_id, N'TB1'); SET @bloque23z_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloque23z_id, N'1'); SET @term23_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo) VALUES (@proyecto_id, @term23_id, N'A'); SET @pos23_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminacion (proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo) VALUES (@proyecto_id, @tc23_id, @pos23_id, N'DESTINO');

    UPDATE nucleo.terminal SET activo = 0 WHERE id = @term23_id;
    PRINT 'FAIL 23: se permitio desactivar un TERMINAL con una posicion ocupada.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51030 PRINT 'PASS 23: desactivacion de TERMINAL con posicion ocupada rechazada.';
    ELSE BEGIN PRINT 'FAIL 23: error inesperado (se esperaba 51030).'; PRINT ERROR_MESSAGE(); END
END CATCH;


BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @gab24_id BIGINT, @inst24_id BIGINT, @senal24_id BIGINT, @puntoI24_id BIGINT, @puntoG24_id BIGINT;
    DECLARE @ruta24_id BIGINT, @tramo24_id BIGINT, @cable24_id BIGINT, @cond24_id BIGINT, @tc24_id BIGINT;
    DECLARE @bloque24_id BIGINT, @term24_id BIGINT, @pos24_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-24', @tipo_gabinete_rio_id); SET @gab24_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0024'); SET @inst24_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto_id, @inst24_id, @clase_control_id, N'027-HV-0024_HY'); SET @senal24_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst24_id); SET @puntoI24_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gab24_id); SET @puntoG24_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal24_id); SET @ruta24_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden)
        VALUES (@proyecto_id, @ruta24_id, NULL, @puntoI24_id, @puntoG24_id, 1);
    SET @tramo24_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-24', 2); SET @cable24_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cable24_id, N'1'); SET @cond24_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo24_id, @cond24_id); SET @tc24_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.bloque_terminal (proyecto_id, gabinete_id, codigo) VALUES (@proyecto_id, @gab24_id, N'TB1'); SET @bloque24_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloque24_id, N'1'); SET @term24_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo) VALUES (@proyecto_id, @term24_id, N'A'); SET @pos24_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminacion (proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo) VALUES (@proyecto_id, @tc24_id, @pos24_id, N'DESTINO');

    UPDATE nucleo.bloque_terminal SET activo = 0 WHERE id = @bloque24_id;
    PRINT 'FAIL 24: se permitio desactivar un BLOQUE_TERMINAL con un terminal ocupado.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51031 PRINT 'PASS 24: desactivacion de BLOQUE_TERMINAL con terminal ocupado rechazada.';
    ELSE BEGIN PRINT 'FAIL 24: error inesperado (se esperaba 51031).'; PRINT ERROR_MESSAGE(); END
END CATCH;


BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @gab25_id BIGINT, @inst25_id BIGINT, @senal25_id BIGINT, @puntoI25_id BIGINT, @puntoG25_id BIGINT;
    DECLARE @ruta25_id BIGINT, @tramo25_id BIGINT, @cable25_id BIGINT, @cond25_id BIGINT, @tc25_id BIGINT;
    DECLARE @bloque25_id BIGINT, @term25_id BIGINT, @pos25_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-25', @tipo_gabinete_rio_id); SET @gab25_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0025'); SET @inst25_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto_id, @inst25_id, @clase_control_id, N'027-HV-0025_HY'); SET @senal25_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst25_id); SET @puntoI25_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gab25_id); SET @puntoG25_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal25_id); SET @ruta25_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden)
        VALUES (@proyecto_id, @ruta25_id, NULL, @puntoI25_id, @puntoG25_id, 1);
    SET @tramo25_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-25', 2); SET @cable25_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cable25_id, N'1'); SET @cond25_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo25_id, @cond25_id); SET @tc25_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.bloque_terminal (proyecto_id, gabinete_id, codigo) VALUES (@proyecto_id, @gab25_id, N'TB1'); SET @bloque25_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloque25_id, N'1'); SET @term25_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo) VALUES (@proyecto_id, @term25_id, N'A'); SET @pos25_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminacion (proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo) VALUES (@proyecto_id, @tc25_id, @pos25_id, N'DESTINO');

    UPDATE nucleo.cable SET activo = 0 WHERE id = @cable25_id;
    PRINT 'FAIL 25: se permitio desactivar un CABLE cuyo CONDUCTOR participa en un TRAMO_CONDUCTOR activo (camino nuevo).';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51021 PRINT 'PASS 25: desactivacion de CABLE en uso via camino nuevo (conductor) rechazada.';
    ELSE BEGIN PRINT 'FAIL 25: error inesperado (se esperaba 51021).'; PRINT ERROR_MESSAGE(); END
END CATCH;


/* ============================================================
   CASO 26
   CONVIVENCIA LEGACY/NUEVO: UN TRAMO CON par_conductor_id
   POBLADO (LEGACY) Y OTRO CON par_conductor_id NULL (NUEVO) EN
   RUTAS DISTINTAS, AMBOS ACTIVOS SIMULTANEAMENTE SIN CONFLICTO;
   DOS TRAMOS NUEVOS (NULL) TAMBIEN COEXISTEN SIN VIOLAR EL
   INDICE FILTRADO.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @gab22a_id BIGINT, @gab22b_id BIGINT, @gab22c_id BIGINT;
    DECLARE @inst22a_id BIGINT, @inst22b_id BIGINT, @inst22c_id BIGINT;
    DECLARE @senal22a_id BIGINT, @senal22b_id BIGINT, @senal22c_id BIGINT;
    DECLARE @puntoI22a_id BIGINT, @puntoC22a_id BIGINT, @puntoI22b_id BIGINT, @puntoC22b_id BIGINT, @puntoI22c_id BIGINT, @puntoC22c_id BIGINT;
    DECLARE @ruta22a_id BIGINT, @ruta22b_id BIGINT, @ruta22c_id BIGINT;
    DECLARE @cable22_id BIGINT, @par22_id BIGINT;

    -- Ruta de un solo tramo INSTRUMENTO -> GABINETE (directo, sin caja
    -- intermedia — mismo patron real "directo a equipo/gabinete"
    -- encontrado en 620-PPS-5005, seccion 36.7 del diagnostico), valido
    -- ante TR_tramo_conexion_validar_secuencia porque el unico tramo YA
    -- termina en GABINETE.
    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-22A', @tipo_gabinete_rio_id); SET @gab22a_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-22B', @tipo_gabinete_rio_id); SET @gab22b_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-22C', @tipo_gabinete_rio_id); SET @gab22c_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0022A'); SET @inst22a_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0022B'); SET @inst22b_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0022C'); SET @inst22c_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto_id, @inst22a_id, @clase_control_id, N'027-HV-0022A_HY'); SET @senal22a_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto_id, @inst22b_id, @clase_control_id, N'027-HV-0022B_HY'); SET @senal22b_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto_id, @inst22c_id, @clase_control_id, N'027-HV-0022C_HY'); SET @senal22c_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst22a_id); SET @puntoI22a_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gab22a_id); SET @puntoC22a_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst22b_id); SET @puntoI22b_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gab22b_id); SET @puntoC22b_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst22c_id); SET @puntoI22c_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gab22c_id); SET @puntoC22c_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal22a_id); SET @ruta22a_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal22b_id); SET @ruta22b_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal22c_id); SET @ruta22c_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-22', 2);
    SET @cable22_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.par_conductor (proyecto_id, cable_id, numero_par) VALUES (@proyecto_id, @cable22_id, 1);
    SET @par22_id = SCOPE_IDENTITY();

    -- Tramo LEGACY (par_conductor_id poblado)
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden)
    VALUES (@proyecto_id, @ruta22a_id, @par22_id, @puntoI22a_id, @puntoC22a_id, 1);

    -- Dos tramos NUEVOS (par_conductor_id NULL) en rutas distintas
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden)
    VALUES (@proyecto_id, @ruta22b_id, NULL, @puntoI22b_id, @puntoC22b_id, 1);
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden)
    VALUES (@proyecto_id, @ruta22c_id, NULL, @puntoI22c_id, @puntoC22c_id, 1);

    IF (SELECT COUNT(*) FROM nucleo.tramo_conexion WHERE ruta_conexion_id IN (@ruta22a_id, @ruta22b_id, @ruta22c_id) AND activo = 1) = 3
       AND (SELECT COUNT(*) FROM nucleo.tramo_conexion WHERE ruta_conexion_id IN (@ruta22b_id, @ruta22c_id) AND par_conductor_id IS NULL AND activo = 1) = 2
        PRINT 'PASS 26: tramo legacy (con par) y dos tramos nuevos (NULL) coexisten sin violar UX_tramo_conexion_par_conductor_id.';
    ELSE
        PRINT 'FAIL 26: la convivencia legacy/nuevo no quedo en el estado esperado.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 26: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 27
   AUDITORIA: created_by/updated_by se pueden poblar en las 6
   tablas nuevas
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @usuario23_id BIGINT;
    SELECT TOP (1) @usuario23_id = id FROM seguridad.usuario;

    IF @usuario23_id IS NULL
    BEGIN
        INSERT INTO seguridad.usuario (email, nombre) VALUES (N'test027@siei.local', N'Test 027');
        SET @usuario23_id = SCOPE_IDENTITY();
    END

    DECLARE @caja23_id BIGINT, @bloque23_id BIGINT, @cable23_id BIGINT, @cond23_id BIGINT;
    INSERT INTO nucleo.caja (proyecto_id, tag_caja) VALUES (@proyecto_id, N'027-CAJA-23');
    SET @caja23_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.bloque_terminal (proyecto_id, caja_id, codigo, created_by) VALUES (@proyecto_id, @caja23_id, N'TB1', @usuario23_id);
    SET @bloque23_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.cable (proyecto_id, tag_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-23', 2);
    SET @cable23_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo, created_by) VALUES (@proyecto_id, @cable23_id, N'1', @usuario23_id);
    SET @cond23_id = SCOPE_IDENTITY();

    IF (SELECT created_by FROM nucleo.bloque_terminal WHERE id = @bloque23_id) = @usuario23_id
       AND (SELECT created_by FROM nucleo.conductor WHERE id = @cond23_id) = @usuario23_id
        PRINT 'PASS 27: created_by se puebla correctamente en bloque_terminal/conductor.';
    ELSE
        PRINT 'FAIL 27: created_by no quedo poblado como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 27: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 28
   INSTRUMENTO -> GABINETE -> MODULO DIRECTO (SIN CAJA), CON
   TERMINACIONES REALES EN AMBOS EXTREMOS DEL TRAMO INTERNO ->
   DEMUESTRA LA TOPOLOGIA "LLEGADA DIRECTA A GABINETE" (revision
   bloqueante de topologia: gabinete puede ser penultimo)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @gab28_id BIGINT, @rack28_id BIGINT, @slot28_id BIGINT, @mod28_id BIGINT, @canal28_id BIGINT;
    DECLARE @inst28_id BIGINT, @senal28_id BIGINT;
    DECLARE @puntoI28_id BIGINT, @puntoG28_id BIGINT, @puntoM28_id BIGINT;
    DECLARE @ruta28_id BIGINT, @tramo28a_id BIGINT, @tramo28b_id BIGINT;
    DECLARE @bloqueGab28_id BIGINT, @termGab28_id BIGINT, @posGab28_id BIGINT;
    DECLARE @bloqueMod28_id BIGINT, @termMod28_id BIGINT, @posMod28_id BIGINT;
    DECLARE @cable28_id BIGINT, @cond28a_id BIGINT, @cond28b_id BIGINT;
    DECLARE @tc28a_id BIGINT, @tc28b_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-28', @tipo_gabinete_rio_id);
    SET @gab28_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack) VALUES (@proyecto_id, @gab28_id, 1);
    SET @rack28_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot) VALUES (@proyecto_id, @rack28_id, 1);
    SET @slot28_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id) VALUES (@proyecto_id, @slot28_id, @catalogo_simple2_id);
    SET @mod28_id = SCOPE_IDENTITY();
    SELECT @canal28_id = id FROM nucleo.canal WHERE modulo_id = @mod28_id AND numero_canal = 0;
    SELECT @bloqueMod28_id = id FROM nucleo.bloque_terminal WHERE modulo_id = @mod28_id AND activo = 1;
    SELECT @termMod28_id = t.id FROM nucleo.terminal t JOIN cat.cat_modulo_io_terminal cmit ON cmit.id = t.catalogo_modulo_io_terminal_id
        WHERE t.bloque_terminal_id = @bloqueMod28_id AND cmit.numero_canal = 0;
    SELECT @posMod28_id = id FROM nucleo.posicion_terminal WHERE terminal_id = @termMod28_id AND activo = 1;

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0028');
    SET @inst28_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tipo_io_id, canal_id, tag_senal)
    VALUES (@proyecto_id, @inst28_id, @clase_control_id, @tipo_ai_id, @canal28_id, N'027-HV-0028_HY');
    SET @senal28_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst28_id);
    SET @puntoI28_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gab28_id);
    SET @puntoG28_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, modulo_id) VALUES (@proyecto_id, @mod28_id);
    SET @puntoM28_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal28_id);
    SET @ruta28_id = SCOPE_IDENTITY();

    -- INSTRUMENTO -> GABINETE (penultimo, sin caja) -> MODULO (final,
    -- mismo gabinete) — topologia B/directa aprobada en la revision.
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden) VALUES
        (@proyecto_id, @ruta28_id, NULL, @puntoI28_id, @puntoG28_id, 1),
        (@proyecto_id, @ruta28_id, NULL, @puntoG28_id, @puntoM28_id, 2);

    SELECT @tramo28a_id = id FROM nucleo.tramo_conexion WHERE ruta_conexion_id = @ruta28_id AND numero_orden = 1;
    SELECT @tramo28b_id = id FROM nucleo.tramo_conexion WHERE ruta_conexion_id = @ruta28_id AND numero_orden = 2;

    IF @tramo28a_id IS NOT NULL AND @tramo28b_id IS NOT NULL
        PRINT 'PASS 28a: INSTRUMENTO -> GABINETE -> MODULO directo (sin caja) aceptado por TR_tramo_conexion_validar_secuencia.';
    ELSE
        PRINT 'FAIL 28a: no se crearon los 2 tramos de la topologia directa a gabinete.';

    -- Cable+conductor del tramo interno (gabinete -> modulo), con
    -- terminaciones reales en ambos extremos: terminal de gabinete
    -- (campo) y terminal de modulo (interno).
    INSERT INTO nucleo.cable (proyecto_id, tag_cable, tipo_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-28', N'JUMPER INTERNO', 2);
    SET @cable28_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.bloque_terminal (proyecto_id, gabinete_id, codigo) VALUES (@proyecto_id, @gab28_id, N'TB1');
    SET @bloqueGab28_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloqueGab28_id, N'15');
    SET @termGab28_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo) VALUES (@proyecto_id, @termGab28_id, N'B');
    SET @posGab28_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cable28_id, N'1');
    SET @cond28a_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo28b_id, @cond28a_id);
    SET @tc28a_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.terminacion (proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo) VALUES
        (@proyecto_id, @tc28a_id, @posGab28_id, N'ORIGEN'),
        (@proyecto_id, @tc28a_id, @posMod28_id, N'DESTINO');

    IF (SELECT COUNT(*) FROM nucleo.terminacion WHERE tramo_conductor_id = @tc28a_id AND activo = 1) = 2
        PRINT 'PASS 28b: tramo interno GABINETE->MODULO con terminaciones ORIGEN (terminal 15/pos B del gabinete) y DESTINO (terminal de modulo) aceptadas.';
    ELSE
        PRINT 'FAIL 28b: no se crearon las 2 terminaciones del tramo interno.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 28: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 29
   INSTRUMENTO -> CAJA -> GABINETE TB1 (terminal 15, posicion A) ->
   [cableado interno] -> MODULO/CANAL/TERMINAL — CASO REAL COMPLETO
   PEDIDO EXPLICITAMENTE (topologia C), con tramo_conductor +
   terminacion + posicion_terminal en AMBOS tramos fisicos.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @gab29_id BIGINT, @rack29_id BIGINT, @slot29_id BIGINT, @mod29_id BIGINT, @canal29_id BIGINT;
    DECLARE @caja29_id BIGINT, @inst29_id BIGINT, @senal29_id BIGINT;
    DECLARE @puntoI29_id BIGINT, @puntoC29_id BIGINT, @puntoG29_id BIGINT, @puntoM29_id BIGINT;
    DECLARE @ruta29_id BIGINT, @tramo29a_id BIGINT, @tramo29b_id BIGINT, @tramo29c_id BIGINT;
    DECLARE @bloqueGab29_id BIGINT, @term29_15_id BIGINT, @pos29A_id BIGINT, @pos29B_id BIGINT;
    DECLARE @bloqueMod29_id BIGINT, @termMod29_id BIGINT, @posMod29_id BIGINT;
    DECLARE @cableCampo29_id BIGINT, @condCampo29_id BIGINT, @tcCampo29_id BIGINT;
    DECLARE @cableInterno29_id BIGINT, @condInterno29_id BIGINT, @tcInterno29_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-29', @tipo_gabinete_rio_id);
    SET @gab29_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack) VALUES (@proyecto_id, @gab29_id, 1);
    SET @rack29_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot) VALUES (@proyecto_id, @rack29_id, 1);
    SET @slot29_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id) VALUES (@proyecto_id, @slot29_id, @catalogo_simple2_id);
    SET @mod29_id = SCOPE_IDENTITY();
    SELECT @canal29_id = id FROM nucleo.canal WHERE modulo_id = @mod29_id AND numero_canal = 0;
    SELECT @bloqueMod29_id = id FROM nucleo.bloque_terminal WHERE modulo_id = @mod29_id AND activo = 1;
    SELECT @termMod29_id = t.id FROM nucleo.terminal t JOIN cat.cat_modulo_io_terminal cmit ON cmit.id = t.catalogo_modulo_io_terminal_id
        WHERE t.bloque_terminal_id = @bloqueMod29_id AND cmit.numero_canal = 0;
    SELECT @posMod29_id = id FROM nucleo.posicion_terminal WHERE terminal_id = @termMod29_id AND activo = 1;

    INSERT INTO nucleo.caja (proyecto_id, tag_caja) VALUES (@proyecto_id, N'027-CAJA-29');
    SET @caja29_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0029');
    SET @inst29_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tipo_io_id, canal_id, tag_senal)
    VALUES (@proyecto_id, @inst29_id, @clase_control_id, @tipo_ai_id, @canal29_id, N'027-HV-0029_HY');
    SET @senal29_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst29_id);
    SET @puntoI29_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, caja_id) VALUES (@proyecto_id, @caja29_id);
    SET @puntoC29_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gab29_id);
    SET @puntoG29_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, modulo_id) VALUES (@proyecto_id, @mod29_id);
    SET @puntoM29_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal29_id);
    SET @ruta29_id = SCOPE_IDENTITY();

    -- INSTRUMENTO -> CAJA -> GABINETE (penultimo) -> MODULO (final,
    -- mismo gabinete) — topologia C completa, 3 tramos.
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden) VALUES
        (@proyecto_id, @ruta29_id, NULL, @puntoI29_id, @puntoC29_id, 1),
        (@proyecto_id, @ruta29_id, NULL, @puntoC29_id, @puntoG29_id, 2),
        (@proyecto_id, @ruta29_id, NULL, @puntoG29_id, @puntoM29_id, 3);

    SELECT @tramo29a_id = id FROM nucleo.tramo_conexion WHERE ruta_conexion_id = @ruta29_id AND numero_orden = 1;
    SELECT @tramo29b_id = id FROM nucleo.tramo_conexion WHERE ruta_conexion_id = @ruta29_id AND numero_orden = 2;
    SELECT @tramo29c_id = id FROM nucleo.tramo_conexion WHERE ruta_conexion_id = @ruta29_id AND numero_orden = 3;

    IF @tramo29a_id IS NOT NULL AND @tramo29b_id IS NOT NULL AND @tramo29c_id IS NOT NULL
        PRINT 'PASS 29a: ruta completa INSTRUMENTO->CAJA->GABINETE->MODULO (3 tramos, topologia C) aceptada.';
    ELSE
        PRINT 'FAIL 29a: no se crearon los 3 tramos de la topologia C.';

    -- Terminal 15 del gabinete TB1, con 2 posiciones: A (cable de campo
    -- desde la caja) y B (cableado interno hacia el modulo) — el caso
    -- exacto pedido, doble aterrizaje del MISMO terminal en posiciones
    -- distintas, sin conflicto de ocupacion.
    INSERT INTO nucleo.bloque_terminal (proyecto_id, gabinete_id, codigo) VALUES (@proyecto_id, @gab29_id, N'TB1');
    SET @bloqueGab29_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminal (proyecto_id, bloque_terminal_id, numero) VALUES (@proyecto_id, @bloqueGab29_id, N'15');
    SET @term29_15_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo) VALUES (@proyecto_id, @term29_15_id, N'A');
    SET @pos29A_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.posicion_terminal (proyecto_id, terminal_id, codigo) VALUES (@proyecto_id, @term29_15_id, N'B');
    SET @pos29B_id = SCOPE_IDENTITY();

    -- Tramo N (caja -> gabinete): cable de campo, conductor + terminacion
    -- DESTINO en terminal 15 / posicion A.
    INSERT INTO nucleo.cable (proyecto_id, tag_cable, tipo_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-CAMPO-29', N'1-1p#16 AWG+SH', 2);
    SET @cableCampo29_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cableCampo29_id, N'1');
    SET @condCampo29_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo29b_id, @condCampo29_id);
    SET @tcCampo29_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminacion (proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo)
    VALUES (@proyecto_id, @tcCampo29_id, @pos29A_id, N'DESTINO');

    -- Tramo N+1 (gabinete -> modulo): cableado interno, conductor +
    -- terminacion ORIGEN en terminal 15 / posicion B (MISMO terminal,
    -- posicion distinta) + terminacion DESTINO en el terminal de modulo.
    INSERT INTO nucleo.cable (proyecto_id, tag_cable, tipo_cable, capacidad_conductores) VALUES (@proyecto_id, N'027-CABLE-INTERNO-29', N'JUMPER INTERNO', 2);
    SET @cableInterno29_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.conductor (proyecto_id, cable_id, codigo) VALUES (@proyecto_id, @cableInterno29_id, N'1');
    SET @condInterno29_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.tramo_conductor (proyecto_id, tramo_conexion_id, conductor_id) VALUES (@proyecto_id, @tramo29c_id, @condInterno29_id);
    SET @tcInterno29_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.terminacion (proyecto_id, tramo_conductor_id, posicion_terminal_id, extremo) VALUES
        (@proyecto_id, @tcInterno29_id, @pos29B_id, N'ORIGEN'),
        (@proyecto_id, @tcInterno29_id, @posMod29_id, N'DESTINO');

    IF (SELECT COUNT(*) FROM nucleo.terminacion WHERE tramo_conductor_id = @tcCampo29_id AND activo = 1) = 1
       AND (SELECT COUNT(*) FROM nucleo.terminacion WHERE tramo_conductor_id = @tcInterno29_id AND activo = 1) = 2
       AND (SELECT COUNT(*) FROM nucleo.posicion_terminal WHERE terminal_id = @term29_15_id AND activo = 1) = 2
        PRINT 'PASS 29b: caso real completo (caja->gabinete TB1 terminal 15/pos A + interno pos B->modulo/canal correcto) con 3 terminaciones aceptadas.';
    ELSE
        PRINT 'FAIL 29b: el caso real completo no quedo en el estado esperado.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 29: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 30
   FAIL: GABINETE A (penultimo) -> MODULO PERTENECIENTE A GABINETE
   B (final) -> RECHAZADO (51034), aunque ambos gabinetes sean del
   mismo proyecto.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @gabA30_id BIGINT, @gabB30_id BIGINT, @rack30_id BIGINT, @slot30_id BIGINT, @mod30_id BIGINT;
    DECLARE @inst30_id BIGINT, @senal30_id BIGINT, @puntoI30_id BIGINT, @puntoGA30_id BIGINT, @puntoM30_id BIGINT;
    DECLARE @ruta30_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-30A', @tipo_gabinete_rio_id);
    SET @gabA30_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-30B', @tipo_gabinete_rio_id);
    SET @gabB30_id = SCOPE_IDENTITY();
    -- el modulo pertenece a GABINETE B, no a GABINETE A
    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack) VALUES (@proyecto_id, @gabB30_id, 1);
    SET @rack30_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot) VALUES (@proyecto_id, @rack30_id, 1);
    SET @slot30_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id) VALUES (@proyecto_id, @slot30_id, @catalogo_simple2_id);
    SET @mod30_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0030');
    SET @inst30_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto_id, @inst30_id, @clase_control_id, N'027-HV-0030_HY');
    SET @senal30_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst30_id);
    SET @puntoI30_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gabA30_id);
    SET @puntoGA30_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, modulo_id) VALUES (@proyecto_id, @mod30_id);
    SET @puntoM30_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal30_id);
    SET @ruta30_id = SCOPE_IDENTITY();

    -- TR_tramo_conexion_validar_secuencia hace su propio ROLLBACK
    -- TRANSACTION al rechazar (igual que 11/16b/17/19): esta insercion va
    -- directa en el TRY exterior, sin anidar, para que el CATCH exterior
    -- sea el unico que decida si hubo o no transaccion que revertir.
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden) VALUES
        (@proyecto_id, @ruta30_id, NULL, @puntoI30_id, @puntoGA30_id, 1),
        (@proyecto_id, @ruta30_id, NULL, @puntoGA30_id, @puntoM30_id, 2);
    PRINT 'FAIL 30: se permitio GABINETE A -> MODULO perteneciente a GABINETE B.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51034
        PRINT 'PASS 30: GABINETE A -> MODULO de GABINETE B rechazado (51034).';
    ELSE
    BEGIN
        PRINT 'FAIL 30: error inesperado (se esperaba 51034).';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 31
   FAIL: INSTRUMENTO -> GABINETE -> CAJA -> MODULO (gabinete ANTES
   del penultimo, no en la posicion permitida) -> RECHAZADO (51017)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @gab31_id BIGINT, @caja31_id BIGINT, @rack31_id BIGINT, @slot31_id BIGINT, @mod31_id BIGINT;
    DECLARE @inst31_id BIGINT, @senal31_id BIGINT;
    DECLARE @puntoI31_id BIGINT, @puntoG31_id BIGINT, @puntoC31_id BIGINT, @puntoM31_id BIGINT, @ruta31_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-31', @tipo_gabinete_rio_id);
    SET @gab31_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.caja (proyecto_id, tag_caja) VALUES (@proyecto_id, N'027-CAJA-31');
    SET @caja31_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack) VALUES (@proyecto_id, @gab31_id, 1);
    SET @rack31_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot) VALUES (@proyecto_id, @rack31_id, 1);
    SET @slot31_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id) VALUES (@proyecto_id, @slot31_id, @catalogo_simple2_id);
    SET @mod31_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0031');
    SET @inst31_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto_id, @inst31_id, @clase_control_id, N'027-HV-0031_HY');
    SET @senal31_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst31_id);
    SET @puntoI31_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gab31_id);
    SET @puntoG31_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, caja_id) VALUES (@proyecto_id, @caja31_id);
    SET @puntoC31_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, modulo_id) VALUES (@proyecto_id, @mod31_id);
    SET @puntoM31_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal31_id);
    SET @ruta31_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden) VALUES
        (@proyecto_id, @ruta31_id, NULL, @puntoI31_id, @puntoG31_id, 1),
        (@proyecto_id, @ruta31_id, NULL, @puntoG31_id, @puntoC31_id, 2),
        (@proyecto_id, @ruta31_id, NULL, @puntoC31_id, @puntoM31_id, 3);
    PRINT 'FAIL 31: se permitio GABINETE antes del penultimo (INSTRUMENTO->GABINETE->CAJA->MODULO).';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51017
        PRINT 'PASS 31: GABINETE antes del penultimo rechazado (51017) — solo puede ser CAJA ahi.';
    ELSE
    BEGIN
        PRINT 'FAIL 31: error inesperado (se esperaba 51017).';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 32
   FAIL: INSTRUMENTO -> GABINETE -> GABINETE -> RECHAZADO (51034,
   el ultimo no es MODULO)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @gabA32_id BIGINT, @gabB32_id BIGINT, @inst32_id BIGINT, @senal32_id BIGINT;
    DECLARE @puntoI32_id BIGINT, @puntoGA32_id BIGINT, @puntoGB32_id BIGINT, @ruta32_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-32A', @tipo_gabinete_rio_id);
    SET @gabA32_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-32B', @tipo_gabinete_rio_id);
    SET @gabB32_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0032');
    SET @inst32_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto_id, @inst32_id, @clase_control_id, N'027-HV-0032_HY');
    SET @senal32_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst32_id);
    SET @puntoI32_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gabA32_id);
    SET @puntoGA32_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gabB32_id);
    SET @puntoGB32_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal32_id);
    SET @ruta32_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden) VALUES
        (@proyecto_id, @ruta32_id, NULL, @puntoI32_id, @puntoGA32_id, 1),
        (@proyecto_id, @ruta32_id, NULL, @puntoGA32_id, @puntoGB32_id, 2);
    PRINT 'FAIL 32: se permitio GABINETE -> GABINETE.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51034
        PRINT 'PASS 32: GABINETE -> GABINETE rechazado (51034) — el ultimo debe ser MODULO.';
    ELSE
    BEGIN
        PRINT 'FAIL 32: error inesperado (se esperaba 51034).';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 33
   FAIL: INSTRUMENTO -> MODULO -> GABINETE (MODULO como intermedio,
   nunca permitido — un modulo solo puede ser el nodo final).
   Destino final = GABINETE (no CAJA) a proposito: un final CAJA ya
   seria invalido por 51007 independientemente de esto — usar
   GABINETE aisla exactamente la regla de MODULO-como-intermedio,
   sin que otra regla dispare primero. -> RECHAZADO (51017)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @rack33_id BIGINT, @slot33_id BIGINT, @mod33_id BIGINT;
    DECLARE @gab33_id BIGINT, @gabFinal33_id BIGINT, @inst33_id BIGINT, @senal33_id BIGINT;
    DECLARE @puntoI33_id BIGINT, @puntoM33_id BIGINT, @puntoGF33_id BIGINT, @ruta33_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-33', @tipo_gabinete_rio_id);
    SET @gab33_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack) VALUES (@proyecto_id, @gab33_id, 1);
    SET @rack33_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot) VALUES (@proyecto_id, @rack33_id, 1);
    SET @slot33_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id) VALUES (@proyecto_id, @slot33_id, @catalogo_simple2_id);
    SET @mod33_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'027-GAB-33-FINAL', @tipo_gabinete_rio_id);
    SET @gabFinal33_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto_id, N'027-HV-0033');
    SET @inst33_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto_id, @inst33_id, @clase_control_id, N'027-HV-0033_HY');
    SET @senal33_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id) VALUES (@proyecto_id, @inst33_id);
    SET @puntoI33_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, modulo_id) VALUES (@proyecto_id, @mod33_id);
    SET @puntoM33_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id) VALUES (@proyecto_id, @gabFinal33_id);
    SET @puntoGF33_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal33_id);
    SET @ruta33_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden) VALUES
        (@proyecto_id, @ruta33_id, NULL, @puntoI33_id, @puntoM33_id, 1),
        (@proyecto_id, @ruta33_id, NULL, @puntoM33_id, @puntoGF33_id, 2);
    PRINT 'FAIL 33: se permitio MODULO como nodo intermedio.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51017
        PRINT 'PASS 33: MODULO como intermedio rechazado (51017) — un modulo solo puede ser el nodo final.';
    ELSE
    BEGIN
        PRINT 'FAIL 33: error inesperado (se esperaba 51017).';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 027';
PRINT '=========================================';
