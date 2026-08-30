SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @proyecto_id BIGINT;
DECLARE @canal_id BIGINT;
DECLARE @modulo_id BIGINT;
DECLARE @gabinete_id BIGINT;
DECLARE @control_id BIGINT;
DECLARE @ai_id BIGINT;

SELECT @proyecto_id = id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

SELECT TOP (1)
    @canal_id = c.id,
    @modulo_id = c.modulo_id,
    @gabinete_id = r.gabinete_id
FROM nucleo.canal c
JOIN nucleo.modulo m ON m.id = c.modulo_id
JOIN nucleo.slot s ON s.id = m.slot_id
JOIN nucleo.rack r ON r.id = s.rack_id
WHERE c.proyecto_id = @proyecto_id
  AND c.numero_canal = 0
  AND c.activo = 1
ORDER BY c.id;

SELECT @control_id = id
FROM cat.cat_clase_senal
WHERE codigo = N'CONTROL';

SELECT @ai_id = id
FROM cat.cat_tipo_io
WHERE codigo = N'AI';

IF @proyecto_id IS NULL
    THROW 52001, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 007 - SECUENCIA Y NODO INTERMEDIO';
PRINT '=========================================';


/* ============================================================
   CASO 1 - ORDEN 1,3
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst1 BIGINT;
    DECLARE @senal1 BIGINT;
    DECLARE @caja1 BIGINT;
    DECLARE @cab1 BIGINT;
    DECLARE @cab2 BIGINT;
    DECLARE @par1 BIGINT;
    DECLARE @par2 BIGINT;
    DECLARE @p_inst1 BIGINT;
    DECLARE @p_caja1 BIGINT;
    DECLARE @p_mod1 BIGINT;
    DECLARE @ruta1 BIGINT;

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-RUTA-007A', N'Prueba orden de ruta');

    SET @inst1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal
    (
        proyecto_id, instrumento_id, clase_senal_id,
        tipo_io_id, canal_id, tag_senal, descripcion
    )
    VALUES
    (
        @proyecto_id, @inst1, @control_id,
        @ai_id, @canal_id,
        N'PIT-RUTA-007A.PV',
        N'Prueba numero de orden'
    );

    SET @senal1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.caja
        (proyecto_id, tag_caja, descripcion)
    VALUES
        (@proyecto_id, N'JB-RUTA-007A', N'Caja prueba');

    SET @caja1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.cable
        (proyecto_id, tag_cable, tipo_cable, capacidad_conductores)
    VALUES
        (@proyecto_id, N'CBL-RUTA-007A1', N'Test', 2);

    SET @cab1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.par_conductor
        (proyecto_id, cable_id, numero_par)
    VALUES
        (@proyecto_id, @cab1, 1);

    SET @par1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.cable
        (proyecto_id, tag_cable, tipo_cable, capacidad_conductores)
    VALUES
        (@proyecto_id, N'CBL-RUTA-007A2', N'Test', 2);

    SET @cab2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.par_conductor
        (proyecto_id, cable_id, numero_par)
    VALUES
        (@proyecto_id, @cab2, 1);

    SET @par2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion
        (proyecto_id, instrumento_id, descripcion)
    VALUES
        (@proyecto_id, @inst1, N'Origen');

    SET @p_inst1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion
        (proyecto_id, caja_id, descripcion)
    VALUES
        (@proyecto_id, @caja1, N'Caja');

    SET @p_caja1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion
        (proyecto_id, modulo_id, descripcion)
    VALUES
        (@proyecto_id, @modulo_id, N'Modulo');

    SET @p_mod1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion
        (proyecto_id, senal_id)
    VALUES
        (@proyecto_id, @senal1);

    SET @ruta1 = SCOPE_IDENTITY();

    -- ERROR: 1 y 3; falta numero_orden = 2
    INSERT INTO nucleo.tramo_conexion
    (
        proyecto_id, ruta_conexion_id, par_conductor_id,
        punto_origen_id, punto_destino_id, numero_orden
    )
    VALUES
        (@proyecto_id, @ruta1, @par1, @p_inst1, @p_caja1, 1),
        (@proyecto_id, @ruta1, @par2, @p_caja1, @p_mod1, 3);

    PRINT 'FAIL 1: SQL Server permitio orden 1,3.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 1: SQL Server rechazo orden no consecutivo.';
    PRINT 'Error esperado:';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2
   GABINETE COMO NODO INTERMEDIO (PENULTIMO) SEGUIDO DEL MODULO QUE
   FISICAMENTE LE PERTENECE -> DEBE SER ACEPTADO.

   ACTUALIZADO EN MIGRACION 015 (revision de topologia aprobada
   explicitamente por el usuario, ver database/migrations/
   015_terminaciones.sql seccion 41 del diagnostico): la regla
   original de este caso ("GABINETE intermedio siempre se rechaza")
   quedo SUPERADA — la regla fisica real exige soportar CABLE DE
   CAMPO -> TERMINAL DE GABINETE + CABLEADO INTERNO -> TERMINAL DE
   MODULO, es decir GABINETE debe poder ser el nodo PENULTIMO de una
   ruta cuando el ultimo nodo es un MODULO que pertenece fisicamente
   a ese mismo gabinete (@modulo_id/@gabinete_id de este archivo ya
   vienen relacionados por el mismo join canal->modulo->slot->rack->
   gabinete de la cabecera). Este archivo de PRUEBA (no una migracion
   congelada) se actualiza para reflejar la regla aprobada — mismo
   criterio ya usado para 24_smoke_gabinete_migracion.sql y otros
   smoke tests cuando una regla de negocio evoluciona con aprobacion
   explicita. La cobertura de "GABINETE de un dueño distinto al del
   modulo final SI se rechaza" vive en database/tests/
   027_smoke_terminaciones.sql (casos 30-33), no aqui.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst2 BIGINT;
    DECLARE @senal2 BIGINT;
    DECLARE @cab3 BIGINT;
    DECLARE @cab4 BIGINT;
    DECLARE @par3 BIGINT;
    DECLARE @par4 BIGINT;
    DECLARE @p_inst2 BIGINT;
    DECLARE @p_gabinete BIGINT;
    DECLARE @p_mod2 BIGINT;
    DECLARE @ruta2 BIGINT;

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, descripcion)
    VALUES
        (@proyecto_id, N'PIT-RUTA-007B', N'Prueba nodo intermedio');

    SET @inst2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal
    (
        proyecto_id, instrumento_id, clase_senal_id,
        tipo_io_id, canal_id, tag_senal, descripcion
    )
    VALUES
    (
        @proyecto_id, @inst2, @control_id,
        @ai_id, @canal_id,
        N'PIT-RUTA-007B.PV',
        N'Prueba GABINETE intermedio'
    );

    SET @senal2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.cable
        (proyecto_id, tag_cable, tipo_cable, capacidad_conductores)
    VALUES
        (@proyecto_id, N'CBL-RUTA-007B1', N'Test', 2);

    SET @cab3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.par_conductor
        (proyecto_id, cable_id, numero_par)
    VALUES
        (@proyecto_id, @cab3, 1);

    SET @par3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.cable
        (proyecto_id, tag_cable, tipo_cable, capacidad_conductores)
    VALUES
        (@proyecto_id, N'CBL-RUTA-007B2', N'Test', 2);

    SET @cab4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.par_conductor
        (proyecto_id, cable_id, numero_par)
    VALUES
        (@proyecto_id, @cab4, 1);

    SET @par4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion
        (proyecto_id, instrumento_id, descripcion)
    VALUES
        (@proyecto_id, @inst2, N'Origen');

    SET @p_inst2 = SCOPE_IDENTITY();

    -- GABINETE como nodo penultimo, seguido del MODULO que le pertenece
    -- fisicamente — valido desde la migracion 015 (ver cabecera del caso).
    INSERT INTO nucleo.punto_conexion
        (proyecto_id, gabinete_id, descripcion)
    VALUES
        (@proyecto_id, @gabinete_id, N'GABINETE como nodo penultimo (valido desde 015)');

    SET @p_gabinete = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion
        (proyecto_id, modulo_id, descripcion)
    VALUES
        (@proyecto_id, @modulo_id, N'Destino final modulo');

    SET @p_mod2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion
        (proyecto_id, senal_id)
    VALUES
        (@proyecto_id, @senal2);

    SET @ruta2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.tramo_conexion
    (
        proyecto_id, ruta_conexion_id, par_conductor_id,
        punto_origen_id, punto_destino_id, numero_orden
    )
    VALUES
        (@proyecto_id, @ruta2, @par3, @p_inst2, @p_gabinete, 1),
        (@proyecto_id, @ruta2, @par4, @p_gabinete, @p_mod2, 2);

    IF @p_gabinete IS NOT NULL AND @p_mod2 IS NOT NULL
        PRINT 'PASS 2: GABINETE como nodo penultimo (seguido del MODULO que le pertenece) fue aceptado (regla vigente desde 015).';
    ELSE
        PRINT 'FAIL 2: la ruta con GABINETE penultimo no quedo en el estado esperado.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: se rechazo GABINETE como nodo penultimo (deberia aceptarse desde 015).';
    PRINT ERROR_MESSAGE();
END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 007';
PRINT '=========================================';
