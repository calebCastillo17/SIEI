SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 043 - nucleo.c_solenoide, nucleo.c_envolvente,
 * nucleo.c_selector_maniobra (migracion 036)
 */

DECLARE @proyecto_id BIGINT;
SELECT @proyecto_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto_id IS NULL
    THROW 54301, 'No existe TEST-001.', 1;

PRINT '=========================================';
PRINT 'TEST 043 - SOLENOIDE / ENVOLVENTE / SELECTOR_MANIOBRA (migracion 036)';
PRINT '=========================================';


/* ============================================================
   CASO 1 - Caso real completo (fila 2 de Instrumentos_ValvNeumaticas):
   2 solenoides (apertura/cierre), 3 cajas distintas (conexiones,
   solenoide, set de aire), y 2 selectores/maniobra (remoto-local +
   maniobra local) — todo en la MISMA ficha tecnica.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha1 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha1 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_solenoide (proyecto_id, ficha_tecnica_id, tipo, funcion, cantidad_valvulas, voltaje_operacion, grado_proteccion)
    VALUES (@proyecto_id, @ficha1, N'4 vías, clase H', N'apertura', N'01 (uno)', N'120 VAC', N'NEMA 4X');
    INSERT INTO nucleo.c_solenoide (proyecto_id, ficha_tecnica_id, tipo, funcion, cantidad_valvulas, voltaje_operacion, grado_proteccion)
    VALUES (@proyecto_id, @ficha1, N'4 vías, clase H', N'cierre', N'01 (uno)', N'120 VAC', N'NEMA 4X');

    INSERT INTO nucleo.c_envolvente (proyecto_id, ficha_tecnica_id, funcion, material, grado_proteccion) VALUES (@proyecto_id, @ficha1, N'solenoide', N'Acero inoxidable AISI 316', N'NEMA 4X');
    INSERT INTO nucleo.c_envolvente (proyecto_id, ficha_tecnica_id, funcion, material, grado_proteccion) VALUES (@proyecto_id, @ficha1, N'set_aire', N'Acero inoxidable AISI 316', N'NEMA 4X');
    INSERT INTO nucleo.c_envolvente (proyecto_id, ficha_tecnica_id, funcion, material, grado_proteccion) VALUES (@proyecto_id, @ficha1, N'conexiones', N'Acero inoxidable AISI 316', N'NEMA 4X');

    INSERT INTO nucleo.c_selector_maniobra (proyecto_id, ficha_tecnica_id, funcion, tipo, tipo_contacto)
    VALUES (@proyecto_id, @ficha1, N'selector_remoto_local', N'Remoto / Local', N'SPDT');
    INSERT INTO nucleo.c_selector_maniobra (proyecto_id, ficha_tecnica_id, funcion, tipo, tipo_contacto)
    VALUES (@proyecto_id, @ficha1, N'maniobra_local', N'Pulsador momentáneo', N'—');

    IF (SELECT COUNT(*) FROM nucleo.c_solenoide WHERE ficha_tecnica_id = @ficha1) = 2
       AND (SELECT COUNT(*) FROM nucleo.c_envolvente WHERE ficha_tecnica_id = @ficha1) = 3
       AND (SELECT COUNT(*) FROM nucleo.c_selector_maniobra WHERE ficha_tecnica_id = @ficha1) = 2
        PRINT 'PASS 1: 2 solenoides + 3 cajas + 2 selectores/maniobra conviven en la misma ficha tecnica (caso real completo).';
    ELSE
        PRINT 'FAIL 1: no se comporto como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 1: se rechazo un caso real valido.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2 - Confirma que las 3 tablas son 1:N REAL (sin ningun unique
   por ficha_tecnica_id) — un cuarto envolvente para la misma ficha
   tambien se acepta.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @ficha2 BIGINT;
    INSERT INTO nucleo.ficha_tecnica_instrumento (proyecto_id) VALUES (@proyecto_id);
    SET @ficha2 = SCOPE_IDENTITY();

    INSERT INTO nucleo.c_envolvente (proyecto_id, ficha_tecnica_id, funcion) VALUES (@proyecto_id, @ficha2, N'uno');
    INSERT INTO nucleo.c_envolvente (proyecto_id, ficha_tecnica_id, funcion) VALUES (@proyecto_id, @ficha2, N'dos');
    INSERT INTO nucleo.c_envolvente (proyecto_id, ficha_tecnica_id, funcion) VALUES (@proyecto_id, @ficha2, N'tres');
    INSERT INTO nucleo.c_envolvente (proyecto_id, ficha_tecnica_id, funcion) VALUES (@proyecto_id, @ficha2, N'cuatro');

    IF (SELECT COUNT(*) FROM nucleo.c_envolvente WHERE ficha_tecnica_id = @ficha2) = 4
        PRINT 'PASS 2: cuatro envolventes para la misma ficha aceptados sin rechazo (1:N real confirmado).';
    ELSE
        PRINT 'FAIL 2: no se comporto como 1:N real.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 2: se rechazo un caso valido de envolventes multiples.';
    PRINT ERROR_MESSAGE();
END CATCH;

PRINT '=========================================';
PRINT 'FIN TEST 043';
PRINT '=========================================';
