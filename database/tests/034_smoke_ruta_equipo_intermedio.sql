SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 034 - EQUIPO COMO NODO INTERMEDIO DE RUTA (migracion 027)
 *
 * Cubre la extension de TR_tramo_conexion_validar_secuencia que permite
 * modelar un "panel electrico" (nucleo.equipo distinto del dueno real de
 * la senal, sin bornas modeladas) como nodo intermedio de una ruta — tanto
 * estrictamente antes del penultimo (Punto 6) como en el propio penultimo
 * (Punto 6b) — y confirma que las reglas previas (015) siguen vigentes sin
 * cambios: GABINETE solo se acepta en el penultimo (nunca antes), y el
 * Punto 6c (51034, MODULO final debe pertenecer al MISMO gabinete cuando el
 * penultimo es GABINETE) no se ve afectado por la presencia de un EQUIPO
 * mas arriba en la cadena.
 *
 * Se usan tramos con par_conductor_id = NULL (modelo nuevo desde 015) para
 * no requerir cable/par_conductor en cada caso — el proposito de este test
 * es la topologia de la ruta, no el conexionado fisico.
 *
 * Cada caso vive en su propia transaccion, revertida al final (o por el
 * propio ROLLBACK interno del trigger en los casos de rechazo esperado) —
 * mismo patron que 007_smoke_secuencia_ruta.sql / 027_smoke_terminaciones.sql.
 */

DECLARE @proyecto_id BIGINT;
DECLARE @tipo_ai_id BIGINT;
DECLARE @clase_control_id BIGINT;
DECLARE @tipo_gabinete_rio_id BIGINT;
DECLARE @tipo_equipo_electrico_id BIGINT;
DECLARE @catalogo_id BIGINT;

SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 53401, 'No existe TEST-001.', 1;

SELECT @tipo_ai_id = id FROM cat.cat_tipo_io WHERE codigo = N'AI';
SELECT @clase_control_id = id FROM cat.cat_clase_senal WHERE codigo = N'CONTROL';
SELECT @tipo_gabinete_rio_id = id FROM cat.cat_tipo_gabinete WHERE codigo = N'RIO';
SELECT @tipo_equipo_electrico_id = id FROM cat.cat_tipo_equipo WHERE codigo = N'ELECTRICO';

PRINT '=========================================';
PRINT 'TEST 034 - RUTA CON EQUIPO INTERMEDIO (migracion 027)';
PRINT '=========================================';


/* ============================================================
   FIXTURE PERMANENTE DE CATALOGO (no se revierte, mismo patron que
   027_smoke_terminaciones.sql): un modulo minimo de 1 canal, suficiente
   para instanciar nucleo.modulo en cada caso — el punto_conexion de un
   modulo no requiere un canal especifico.
   ============================================================ */

SELECT @catalogo_id = id FROM cat.cat_modulo_io WHERE fabricante = N'SIEI TEST' AND modelo = N'TEST-034-SIMPLE1';
IF @catalogo_id IS NULL
BEGIN
    INSERT INTO cat.cat_modulo_io (fabricante, modelo, tipo_io_id, canales_max)
    VALUES (N'SIEI TEST', N'TEST-034-SIMPLE1', @tipo_ai_id, 1);
    SET @catalogo_id = SCOPE_IDENTITY();
END


/* ============================================================
   CASO 1 - EQUIPO ESTRICTAMENTE ANTES DEL PENULTIMO (panel distinto del
   dueno): DUENO(equipo) -> PANEL(equipo) -> GABINETE -> MODULO (mismo
   gabinete). Topologia real aprobada por el usuario (ej. 620-PPS-5005 ->
   620-AFM-5005). DEBE SER ACEPTADO desde la migracion 027.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @eq_dueno1 BIGINT, @eq_panel1 BIGINT, @senal1 BIGINT;
    DECLARE @gab1 BIGINT, @rack1 BIGINT, @slot1 BIGINT, @mod1 BIGINT;
    DECLARE @p_dueno1 BIGINT, @p_panel1 BIGINT, @p_gab1 BIGINT, @p_mod1 BIGINT;
    DECLARE @ruta1 BIGINT;

    INSERT INTO nucleo.equipo (proyecto_id, tag_equipo, descripcion, tipo_equipo_id)
    VALUES (@proyecto_id, N'EQ-034-DUENO-1', N'Prueba 034 dueno', @tipo_equipo_electrico_id);
    SET @eq_dueno1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.equipo (proyecto_id, tag_equipo, descripcion, tipo_equipo_id)
    VALUES (@proyecto_id, N'EQ-034-PANEL-1', N'Prueba 034 panel electrico', @tipo_equipo_electrico_id);
    SET @eq_panel1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, equipo_id, clase_senal_id, tag_senal, descripcion)
    VALUES (@proyecto_id, @eq_dueno1, @clase_control_id, N'SIG-034-1', N'Prueba EQUIPO intermedio');
    SET @senal1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'034-GAB-1', @tipo_gabinete_rio_id);
    SET @gab1 = SCOPE_IDENTITY();
    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack) VALUES (@proyecto_id, @gab1, 1);
    SET @rack1 = SCOPE_IDENTITY();
    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot) VALUES (@proyecto_id, @rack1, 1);
    SET @slot1 = SCOPE_IDENTITY();
    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id) VALUES (@proyecto_id, @slot1, @catalogo_id);
    SET @mod1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, equipo_id, descripcion) VALUES (@proyecto_id, @eq_dueno1, N'Origen dueno');
    SET @p_dueno1 = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, equipo_id, descripcion) VALUES (@proyecto_id, @eq_panel1, N'Panel electrico intermedio');
    SET @p_panel1 = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id, descripcion) VALUES (@proyecto_id, @gab1, N'Gabinete penultimo');
    SET @p_gab1 = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, modulo_id, descripcion) VALUES (@proyecto_id, @mod1, N'Modulo final');
    SET @p_mod1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal1);
    SET @ruta1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden)
    VALUES
        (@proyecto_id, @ruta1, NULL, @p_dueno1, @p_panel1, 1),
        (@proyecto_id, @ruta1, NULL, @p_panel1, @p_gab1, 2),
        (@proyecto_id, @ruta1, NULL, @p_gab1, @p_mod1, 3);

    PRINT 'PASS 1: EQUIPO (panel electrico) aceptado como nodo intermedio antes del penultimo.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 1: se rechazo EQUIPO como nodo intermedio (deberia aceptarse desde 027).';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2 - EQUIPO COMO PENULTIMO NODO, SEGUIDO DIRECTO DE UN MODULO:
   DUENO(instrumento) -> PANEL(equipo) -> MODULO. DEBE SER ACEPTADO.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst2 BIGINT, @eq_panel2 BIGINT, @senal2 BIGINT;
    DECLARE @gab2 BIGINT, @rack2 BIGINT, @slot2 BIGINT, @mod2 BIGINT;
    DECLARE @p_inst2 BIGINT, @p_panel2 BIGINT, @p_mod2 BIGINT;
    DECLARE @ruta2 BIGINT;

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento, descripcion)
    VALUES (@proyecto_id, N'PIT-034-2', N'Prueba 034 penultimo EQUIPO');
    SET @inst2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.equipo (proyecto_id, tag_equipo, descripcion, tipo_equipo_id)
    VALUES (@proyecto_id, N'EQ-034-PANEL-2', N'Prueba 034 panel penultimo', @tipo_equipo_electrico_id);
    SET @eq_panel2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal, descripcion)
    VALUES (@proyecto_id, @inst2, @clase_control_id, N'PIT-034-2.PV', N'Prueba EQUIPO penultimo');
    SET @senal2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'034-GAB-2', @tipo_gabinete_rio_id);
    SET @gab2 = SCOPE_IDENTITY();
    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack) VALUES (@proyecto_id, @gab2, 1);
    SET @rack2 = SCOPE_IDENTITY();
    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot) VALUES (@proyecto_id, @rack2, 1);
    SET @slot2 = SCOPE_IDENTITY();
    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id) VALUES (@proyecto_id, @slot2, @catalogo_id);
    SET @mod2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id, descripcion) VALUES (@proyecto_id, @inst2, N'Origen dueno');
    SET @p_inst2 = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, equipo_id, descripcion) VALUES (@proyecto_id, @eq_panel2, N'Panel electrico penultimo');
    SET @p_panel2 = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, modulo_id, descripcion) VALUES (@proyecto_id, @mod2, N'Modulo final');
    SET @p_mod2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal2);
    SET @ruta2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden)
    VALUES
        (@proyecto_id, @ruta2, NULL, @p_inst2, @p_panel2, 1),
        (@proyecto_id, @ruta2, NULL, @p_panel2, @p_mod2, 2);

    PRINT 'PASS 2: EQUIPO (panel electrico) aceptado como nodo penultimo, terminando directo en MODULO.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: se rechazo EQUIPO como nodo penultimo (deberia aceptarse desde 027).';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3 (REGRESION) - GABINETE ESTRICTAMENTE ANTES DEL PENULTIMO SIGUE
   SIENDO RECHAZADO: DUENO(instrumento) -> GABINETE -> CAJA -> MODULO. El
   GABINETE esta en rn=1 < total-1=2 (no en el penultimo), asi que la
   regla de 027 (que solo agrega CAJA/EQUIPO ahi, no GABINETE) sigue
   exigiendo el rechazo — sin cambios respecto a 015.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst3 BIGINT, @senal3 BIGINT, @caja3 BIGINT;
    DECLARE @gab3 BIGINT, @rack3 BIGINT, @slot3 BIGINT, @mod3 BIGINT;
    DECLARE @p_inst3 BIGINT, @p_gab3 BIGINT, @p_caja3 BIGINT, @p_mod3 BIGINT;
    DECLARE @ruta3 BIGINT;

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento, descripcion)
    VALUES (@proyecto_id, N'PIT-034-3', N'Prueba 034 GABINETE temprano');
    SET @inst3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal, descripcion)
    VALUES (@proyecto_id, @inst3, @clase_control_id, N'PIT-034-3.PV', N'Prueba GABINETE temprano');
    SET @senal3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.caja (proyecto_id, tag_caja, descripcion) VALUES (@proyecto_id, N'JB-034-3', N'Caja prueba 034');
    SET @caja3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'034-GAB-3', @tipo_gabinete_rio_id);
    SET @gab3 = SCOPE_IDENTITY();
    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack) VALUES (@proyecto_id, @gab3, 1);
    SET @rack3 = SCOPE_IDENTITY();
    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot) VALUES (@proyecto_id, @rack3, 1);
    SET @slot3 = SCOPE_IDENTITY();
    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id) VALUES (@proyecto_id, @slot3, @catalogo_id);
    SET @mod3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id, descripcion) VALUES (@proyecto_id, @inst3, N'Origen dueno');
    SET @p_inst3 = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id, descripcion) VALUES (@proyecto_id, @gab3, N'GABINETE demasiado temprano');
    SET @p_gab3 = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, caja_id, descripcion) VALUES (@proyecto_id, @caja3, N'Caja penultimo');
    SET @p_caja3 = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, modulo_id, descripcion) VALUES (@proyecto_id, @mod3, N'Modulo final');
    SET @p_mod3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal3);
    SET @ruta3 = SCOPE_IDENTITY();

    -- ERROR esperado: GABINETE en rn=1 (estrictamente antes del penultimo,
    -- total=3) no es CAJA ni EQUIPO.
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden)
    VALUES
        (@proyecto_id, @ruta3, NULL, @p_inst3, @p_gab3, 1),
        (@proyecto_id, @ruta3, NULL, @p_gab3, @p_caja3, 2),
        (@proyecto_id, @ruta3, NULL, @p_caja3, @p_mod3, 3);

    PRINT 'FAIL 3: se acepto GABINETE demasiado temprano (deberia seguir rechazandose).';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 3: GABINETE estrictamente antes del penultimo sigue siendo rechazado (regresion 015 OK).';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 4 (REGRESION) - 51034 SIGUE VIGENTE CON EQUIPO EN LA CADENA:
   DUENO(equipo) -> PANEL(equipo) -> GABINETE A (penultimo) -> MODULO de
   un GABINETE B distinto (final). Debe rechazarse igual que sin EQUIPO
   de por medio — la presencia de un panel electrico mas arriba no
   relaja la exigencia "modulo final debe pertenecer FISICAMENTE al
   mismo gabinete que el penultimo".
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @eq_dueno4 BIGINT, @eq_panel4 BIGINT, @senal4 BIGINT;
    DECLARE @gabA4 BIGINT, @gabB4 BIGINT, @rackB4 BIGINT, @slotB4 BIGINT, @modB4 BIGINT;
    DECLARE @p_dueno4 BIGINT, @p_panel4 BIGINT, @p_gabA4 BIGINT, @p_modB4 BIGINT;
    DECLARE @ruta4 BIGINT;

    INSERT INTO nucleo.equipo (proyecto_id, tag_equipo, descripcion, tipo_equipo_id)
    VALUES (@proyecto_id, N'EQ-034-DUENO-4', N'Prueba 034 dueno 51034', @tipo_equipo_electrico_id);
    SET @eq_dueno4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.equipo (proyecto_id, tag_equipo, descripcion, tipo_equipo_id)
    VALUES (@proyecto_id, N'EQ-034-PANEL-4', N'Prueba 034 panel 51034', @tipo_equipo_electrico_id);
    SET @eq_panel4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, equipo_id, clase_senal_id, tag_senal, descripcion)
    VALUES (@proyecto_id, @eq_dueno4, @clase_control_id, N'SIG-034-4', N'Prueba 51034 con EQUIPO intermedio');
    SET @senal4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'034-GAB-4A', @tipo_gabinete_rio_id);
    SET @gabA4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id) VALUES (@proyecto_id, N'034-GAB-4B', @tipo_gabinete_rio_id);
    SET @gabB4 = SCOPE_IDENTITY();
    INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack) VALUES (@proyecto_id, @gabB4, 1);
    SET @rackB4 = SCOPE_IDENTITY();
    INSERT INTO nucleo.slot (proyecto_id, rack_id, numero_slot) VALUES (@proyecto_id, @rackB4, 1);
    SET @slotB4 = SCOPE_IDENTITY();
    INSERT INTO nucleo.modulo (proyecto_id, slot_id, catalogo_modulo_id) VALUES (@proyecto_id, @slotB4, @catalogo_id);
    SET @modB4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, equipo_id, descripcion) VALUES (@proyecto_id, @eq_dueno4, N'Origen dueno');
    SET @p_dueno4 = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, equipo_id, descripcion) VALUES (@proyecto_id, @eq_panel4, N'Panel electrico intermedio');
    SET @p_panel4 = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id, descripcion) VALUES (@proyecto_id, @gabA4, N'Gabinete A penultimo');
    SET @p_gabA4 = SCOPE_IDENTITY();
    INSERT INTO nucleo.punto_conexion (proyecto_id, modulo_id, descripcion) VALUES (@proyecto_id, @modB4, N'Modulo de un gabinete B distinto');
    SET @p_modB4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.ruta_conexion (proyecto_id, senal_id) VALUES (@proyecto_id, @senal4);
    SET @ruta4 = SCOPE_IDENTITY();

    -- ERROR esperado (51034): el modulo final pertenece a @gabB4, no a
    -- @gabA4 (el penultimo).
    INSERT INTO nucleo.tramo_conexion (proyecto_id, ruta_conexion_id, par_conductor_id, punto_origen_id, punto_destino_id, numero_orden)
    VALUES
        (@proyecto_id, @ruta4, NULL, @p_dueno4, @p_panel4, 1),
        (@proyecto_id, @ruta4, NULL, @p_panel4, @p_gabA4, 2),
        (@proyecto_id, @ruta4, NULL, @p_gabA4, @p_modB4, 3);

    PRINT 'FAIL 4: se acepto un MODULO final de un gabinete distinto al penultimo (51034 deberia seguir rechazando esto).';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 4: 51034 sigue rechazando MODULO final de gabinete distinto, incluso con EQUIPO intermedio (regresion OK).';
    PRINT ERROR_MESSAGE();
END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 034';
PRINT '=========================================';
