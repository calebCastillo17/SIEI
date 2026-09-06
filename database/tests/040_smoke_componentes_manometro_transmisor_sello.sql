SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 040 - nucleo.c_manometro, nucleo.c_transmisor,
 * nucleo.c_sello_diafragma (migracion 033)
 */

DECLARE @proyecto_id BIGINT;
SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 54001, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 040 - C_MANOMETRO / C_TRANSMISOR / C_SELLO_DIAFRAGMA (migracion 033)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - Caso real completo: un manometro CON sello de diafragma
   (INS-DOC-01-02 del Excel real) — misma ficha tecnica, dos componentes
   distintos a la vez.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha1 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id, modelo) VALUES (@proyecto_id, N'VTS');
    SET @ficha1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_manometro (proyecto_id, ficha_tecnica_id, tipo, rango_medicion, conexion_proceso, grado_proteccion)
    VALUES (@proyecto_id, @ficha1, N'Tubo Bourdon, servicio pesado', N'0 - 60 psi', N'Inferior - 1/2" MNPT', N'IP66');

    INSERT INTO nucleo.c_sello_diafragma (proyecto_id, ficha_tecnica_id, tipo, material_diafragma, fluido_llenado, conexion_proceso, modelo)
    VALUES (@proyecto_id, @ficha1, N'Sello químico', N'Acero inoxidable 316', N'VTS (Notas 1,6)', N'Brida 2", FF, StdF, CL150, ASME B16.5', N'VTS (Nota 1)');

    IF (SELECT COUNT(*) FROM nucleo.c_manometro WHERE ficha_tecnica_id = @ficha1) = 1
       AND (SELECT COUNT(*) FROM nucleo.c_sello_diafragma WHERE ficha_tecnica_id = @ficha1) = 1
        PRINT 'PASS 1: manometro + sello de diafragma coexisten en la misma ficha tecnica (caso real INS-DOC-01-02).';
    ELSE
        PRINT 'FAIL 1: no coexistieron como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 1: se rechazo un caso real valido.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2 - c_manometro: 1:0..1 con ficha_tecnica (un segundo manometro
   para la MISMA ficha activa debe rechazarse).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha2 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_manometro (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha2, N'Primero');

    BEGIN TRY
        INSERT INTO nucleo.c_manometro (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha2, N'Segundo');
        PRINT 'FAIL 2: se acepto un segundo c_manometro activo para la misma ficha (deberia rechazarse).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 2: segundo c_manometro activo para la misma ficha rechazado por UX_c_manometro_ficha_tecnica_activo.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: error inesperado en c_manometro.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3 - c_transmisor: caso real INS-DOC-02-01 (transmisor de presion
   con sello quimico) + verifica que grado_proteccion vive AQUI, no en
   la cabecera (columna eliminada).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha3 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id, modelo) VALUES (@proyecto_id, N'VTS (Nota 1)');
    SET @ficha3 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_transmisor (
        proyecto_id, ficha_tecnica_id, tipo_sensor, tipo_medicion, rango_ajustado, exactitud,
        alimentacion, senal_salida, protocolo_comunicacion, conexion_electrica, conexion_proceso, grado_proteccion
    )
    VALUES (
        @proyecto_id, @ficha3, N'Elemento de tensión, capacitivo o resonante', N'Presión manométrica', N'0 - 60 psi', N'± 0.1% del span',
        N'Energizado por lazo (2 hilos), 24 VDC', N'4 - 20 mA, HART, capacidad de carga 500 ohm', N'HART (Nota 4)', N'3/4" FNPT', N'1/2" MNPT', N'NEMA 4X'
    );

    IF EXISTS (SELECT 1 FROM nucleo.c_transmisor WHERE ficha_tecnica_id = @ficha3 AND grado_proteccion = N'NEMA 4X')
        PRINT 'PASS 3: c_transmisor.grado_proteccion persistio correctamente (nivel componente, no cabecera).';
    ELSE
        PRINT 'FAIL 3: grado_proteccion no persistio como se esperaba.';

    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('nucleo.ficha_tecnica_instrumento') AND name = 'grado_proteccion')
        PRINT 'PASS 3b: ficha_tecnica_instrumento ya NO tiene grado_proteccion (correccion de migracion 033 aplicada).';
    ELSE
        PRINT 'FAIL 3b: la columna grado_proteccion todavia existe en la cabecera.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 3: se rechazo un caso real valido de c_transmisor.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 4 - c_sello_diafragma: 1:0..1 con ficha_tecnica.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha4 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha4 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_sello_diafragma (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha4, N'Sello químico');

    BEGIN TRY
        INSERT INTO nucleo.c_sello_diafragma (proyecto_id, ficha_tecnica_id, tipo) VALUES (@proyecto_id, @ficha4, N'Otro sello');
        PRINT 'FAIL 4: se acepto un segundo c_sello_diafragma activo para la misma ficha (deberia rechazarse).';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 4: segundo c_sello_diafragma activo para la misma ficha rechazado correctamente.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 4: error inesperado en c_sello_diafragma.';
    PRINT ERROR_MESSAGE();
END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 040';
PRINT '=========================================';
