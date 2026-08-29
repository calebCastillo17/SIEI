SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 025 - SEÑALES: tag_senal opcional, codigo_senal, causa_alarma,
 * tipo_dato_com_id, es_loop_powered (migracion 013).
 *
 * NOTA DE ESTILO: TR_senal_validar_clase hace ROLLBACK TRANSACTION el
 * mismo antes de THROW cuando rechaza una fila — eso termina la
 * transaccion COMPLETA, no solo la sentencia que fallo. Por eso, igual
 * que 003_smoke_clase_senal.sql, cada asercion (incluso las que se
 * esperan exitosas) vive en su propio BEGIN TRY/BEGIN TRANSACTION
 * independiente — nunca dos INSERTs que puedan disparar ese trigger
 * comparten una misma transaccion abierta.
 */

DECLARE @proyecto1_id BIGINT;
DECLARE @cliente_id BIGINT;
DECLARE @control_id BIGINT;
DECLARE @com_id BIGINT;
DECLARE @tipoDatoBit_id BIGINT;
DECLARE @tipoAi_id BIGINT;
DECLARE @direccionIn_id BIGINT;

SELECT @proyecto1_id = id, @cliente_id = cliente_id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001' AND activo = 1;

IF @proyecto1_id IS NULL
    THROW 52501, 'No existe TEST-001.', 1;

SELECT @control_id = id FROM cat.cat_clase_senal WHERE codigo = N'CONTROL';
SELECT @com_id = id FROM cat.cat_clase_senal WHERE codigo = N'COM';
SELECT @tipoDatoBit_id = id FROM cat.cat_tipo_dato_com WHERE codigo = N'BIT';
SELECT @tipoAi_id = id FROM cat.cat_tipo_io WHERE codigo = N'AI';
SELECT @direccionIn_id = id FROM cat.cat_direccion_com WHERE codigo = N'IN';

PRINT '=========================================';
PRINT 'TEST 025 - SEÑALES OPCIONALES (migracion 013)';
PRINT '=========================================';


/* ============================================================
   CASO 1
   cat.cat_tipo_dato_com TRAE EXACTAMENTE LOS 7 VALORES ESPERADOS
   ============================================================ */

IF (SELECT COUNT(*) FROM cat.cat_tipo_dato_com WHERE codigo IN (N'BIT', N'WORD', N'DWORD', N'UINT', N'UDINT', N'DINT', N'REAL')) = 7
   AND (SELECT COUNT(*) FROM cat.cat_tipo_dato_com) = 7
    PRINT 'PASS 1: cat.cat_tipo_dato_com tiene exactamente los 7 codigos esperados.';
ELSE
    PRINT 'FAIL 1: cat.cat_tipo_dato_com no tiene exactamente esos 7 codigos.';


/* ============================================================
   CASO 2
   CREAR CONTROL SIN tag_senal -> PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst2_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-A');
    SET @inst2_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal)
    VALUES (@proyecto1_id, @inst2_id, @control_id, NULL);

    PRINT 'PASS 2: CONTROL sin tag_senal fue aceptado.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 2: CONTROL sin tag_senal fue rechazado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3
   CREAR COM SIN tag_senal -> PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst3_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-B');
    SET @inst3_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal)
    VALUES (@proyecto1_id, @inst3_id, @com_id, NULL);

    PRINT 'PASS 3: COM sin tag_senal fue aceptado.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 3: COM sin tag_senal fue rechazado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 4
   MULTIPLES SEÑALES CON tag_senal = NULL EN EL MISMO PROYECTO
   CONVIVEN SIN VIOLAR UX_senal_proyecto_tag
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst4a_id BIGINT, @inst4b_id BIGINT, @inst4c_id BIGINT;

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-C1');
    SET @inst4a_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-C2');
    SET @inst4b_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-C3');
    SET @inst4c_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto1_id, @inst4a_id, @com_id, NULL);
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto1_id, @inst4b_id, @com_id, NULL);
    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal) VALUES (@proyecto1_id, @inst4c_id, @com_id, NULL);

    PRINT 'PASS 4: tres senales con tag_senal = NULL en el mismo proyecto conviven sin conflicto.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 4: SQL Server rechazo multiples tag_senal = NULL en el mismo proyecto.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 5
   MISMO tag_senal ACTIVO + MISMO PROYECTO -> RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst5a_id BIGINT, @inst5b_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-D1');
    SET @inst5a_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-D2');
    SET @inst5b_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal)
    VALUES (@proyecto1_id, @inst5a_id, @control_id, N'TAG-DUP-025');

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal)
    VALUES (@proyecto1_id, @inst5b_id, @control_id, N'TAG-DUP-025');

    PRINT 'FAIL 5: SQL Server permitio el mismo tag_senal activo en el mismo proyecto.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'PASS 5: SQL Server rechazo el mismo tag_senal activo en el mismo proyecto.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 6
   MISMO tag_senal + PROYECTOS DISTINTOS -> PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @proyecto2_id BIGINT;
    INSERT INTO nucleo.proyecto (cliente_id, codigo_proyecto, nombre)
    VALUES (@cliente_id, N'TEST-025', N'Proyecto temporal para prueba de tag cruzado');
    SET @proyecto2_id = SCOPE_IDENTITY();

    DECLARE @inst6a_id BIGINT, @inst6b_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-E1');
    SET @inst6a_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto2_id, N'PIT-025-E2');
    SET @inst6b_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal)
    VALUES (@proyecto1_id, @inst6a_id, @control_id, N'TAG-CRUZADO-025');

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal)
    VALUES (@proyecto2_id, @inst6b_id, @control_id, N'TAG-CRUZADO-025');

    PRINT 'PASS 6: el mismo tag_senal fue permitido en un proyecto distinto.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 6: SQL Server rechazo el mismo tag_senal en un proyecto distinto.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 7
   codigo_senal = NULL -> PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst7_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-F1');
    SET @inst7_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal, codigo_senal)
    VALUES (@proyecto1_id, @inst7_id, @control_id, N'TAG-025-F1', NULL);

    PRINT 'PASS 7: codigo_senal = NULL fue aceptado.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 7: codigo_senal = NULL fue rechazado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 8
   codigo_senal CON VALOR LEGACY -> PRESERVADO LITERAL
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst8_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-F2');
    SET @inst8_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal, codigo_senal)
    VALUES (@proyecto1_id, @inst8_id, @control_id, N'TAG-025-F2', N'620-SIG-000259');

    IF EXISTS (SELECT 1 FROM nucleo.senal WHERE instrumento_id = @inst8_id AND codigo_senal = N'620-SIG-000259')
        PRINT 'PASS 8: codigo_senal legacy se preservo literal, sin normalizacion.';
    ELSE
        PRINT 'FAIL 8: codigo_senal legacy no se preservo como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 8: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 9
   DOS SEÑALES CON EL MISMO codigo_senal EN EL MISMO PROYECTO ->
   PERMITIDO (sin UNIQUE, decision explicita del usuario en 013)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst9a_id BIGINT, @inst9b_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-F3');
    SET @inst9a_id = SCOPE_IDENTITY();
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-F4');
    SET @inst9b_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal, codigo_senal)
    VALUES (@proyecto1_id, @inst9a_id, @control_id, N'TAG-025-F3', N'620-SIG-000260');

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tag_senal, codigo_senal)
    VALUES (@proyecto1_id, @inst9b_id, @control_id, N'TAG-025-F4', N'620-SIG-000260');

    PRINT 'PASS 9: dos señales con el mismo codigo_senal en el mismo proyecto fueron permitidas (sin UNIQUE).';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 9: SQL Server rechazo codigo_senal duplicado — no deberia haber UNIQUE.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 10
   CONTROL + tipo_dato_com_id -> RECHAZADO (51009, trigger extendido)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst10_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-G1');
    SET @inst10_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tipo_dato_com_id)
    VALUES (@proyecto1_id, @inst10_id, @control_id, @tipoDatoBit_id);

    PRINT 'FAIL 10: SQL Server permitio CONTROL con tipo_dato_com_id.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51009
        PRINT 'PASS 10: CONTROL con tipo_dato_com_id fue rechazado (51009, trigger extendido).';
    ELSE
    BEGIN
        PRINT 'FAIL 10: se produjo un error distinto al esperado.';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 11
   COM + tipo_dato_com_id VALIDO -> PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst11_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-G2');
    SET @inst11_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tipo_dato_com_id)
    VALUES (@proyecto1_id, @inst11_id, @com_id, @tipoDatoBit_id);

    PRINT 'PASS 11: COM con tipo_dato_com_id valido fue aceptado.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 11: SQL Server rechazo COM con tipo_dato_com_id valido.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 12
   COM + es_loop_powered -> RECHAZADO (51008, trigger extendido)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst12_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-H1');
    SET @inst12_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, es_loop_powered)
    VALUES (@proyecto1_id, @inst12_id, @com_id, 1);

    PRINT 'FAIL 12: SQL Server permitio COM con es_loop_powered.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51008
        PRINT 'PASS 12: COM con es_loop_powered fue rechazado (51008, trigger extendido).';
    ELSE
    BEGIN
        PRINT 'FAIL 12: se produjo un error distinto al esperado.';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 13
   CONTROL + es_loop_powered = NULL -> PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst13_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-H2');
    SET @inst13_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, es_loop_powered)
    VALUES (@proyecto1_id, @inst13_id, @control_id, NULL);

    PRINT 'PASS 13: CONTROL con es_loop_powered = NULL fue aceptado.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 13: CONTROL con es_loop_powered = NULL fue rechazado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 14
   CONTROL + es_loop_powered = 1 -> PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst14_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-H3');
    SET @inst14_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, es_loop_powered)
    VALUES (@proyecto1_id, @inst14_id, @control_id, 1);

    PRINT 'PASS 14: CONTROL con es_loop_powered = 1 fue aceptado.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 14: CONTROL con es_loop_powered = 1 fue rechazado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 15
   causa_alarma PERMITIDO EN CONTROL (no exclusivo de ninguna clase)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst15_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-I1');
    SET @inst15_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, causa_alarma)
    VALUES (@proyecto1_id, @inst15_id, @control_id, 1);

    PRINT 'PASS 15: causa_alarma = 1 fue aceptado en una señal CONTROL.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 15: causa_alarma fue rechazado en CONTROL.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 16
   causa_alarma PERMITIDO EN COM (no exclusivo de ninguna clase)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst16_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-I2');
    SET @inst16_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, causa_alarma)
    VALUES (@proyecto1_id, @inst16_id, @com_id, 1);

    PRINT 'PASS 16: causa_alarma = 1 fue aceptado en una señal COM.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 16: causa_alarma fue rechazado en COM.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 17
   CK_senal_tipo_dato_com_loop_excl: tipo_dato_com_id Y es_loop_powered
   juntos -> RECHAZADO (defensa de fila; el CHECK corre antes que
   cualquier trigger AFTER, asi que dispara primero sin importar la clase)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst17_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-J1');
    SET @inst17_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tipo_dato_com_id, es_loop_powered)
    VALUES (@proyecto1_id, @inst17_id, @control_id, @tipoDatoBit_id, 1);

    PRINT 'FAIL 17: SQL Server permitio tipo_dato_com_id y es_loop_powered juntos.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_MESSAGE() LIKE N'%CK_senal_tipo_dato_com_loop_excl%'
        PRINT 'PASS 17: CK_senal_tipo_dato_com_loop_excl rechazo tipo_dato_com_id + es_loop_powered juntos.';
    ELSE
    BEGIN
        PRINT 'FAIL 17: se produjo un error distinto al esperado.';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 18
   OWNER XOR (instrumento_id / equipo_id) SIGUE FUNCIONANDO SIN CAMBIO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.senal (proyecto_id, clase_senal_id, tag_senal)
    VALUES (@proyecto1_id, @control_id, N'TAG-025-SINDUENO');

    PRINT 'FAIL 18: SQL Server permitio una senal sin instrumento_id ni equipo_id.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_MESSAGE() LIKE N'%CK_senal_origen_xor%'
        PRINT 'PASS 18: CK_senal_origen_xor sigue exigiendo exactamente un dueño, sin cambio.';
    ELSE
    BEGIN
        PRINT 'FAIL 18: se produjo un error distinto al esperado.';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 19
   REGLA PREEXISTENTE: COM CON tipo_io_id -> SIGUE RECHAZADO (51008)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst19_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-K1');
    SET @inst19_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, tipo_io_id)
    VALUES (@proyecto1_id, @inst19_id, @com_id, @tipoAi_id);

    PRINT 'FAIL 19: SQL Server permitio COM con tipo_io_id.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51008
        PRINT 'PASS 19: COM con tipo_io_id sigue rechazado (51008, regla preexistente intacta).';
    ELSE
    BEGIN
        PRINT 'FAIL 19: error distinto al esperado.';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 20
   REGLA PREEXISTENTE: CONTROL CON direccion_com_id -> SIGUE
   RECHAZADO (51009)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @inst20_id BIGINT;
    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento) VALUES (@proyecto1_id, N'PIT-025-K2');
    SET @inst20_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.senal (proyecto_id, instrumento_id, clase_senal_id, direccion_com_id)
    VALUES (@proyecto1_id, @inst20_id, @control_id, @direccionIn_id);

    PRINT 'FAIL 20: SQL Server permitio CONTROL con direccion_com_id.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_NUMBER() = 51009
        PRINT 'PASS 20: CONTROL con direccion_com_id sigue rechazado (51009, regla preexistente intacta).';
    ELSE
    BEGIN
        PRINT 'FAIL 20: error distinto al esperado.';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 025';
PRINT '=========================================';
