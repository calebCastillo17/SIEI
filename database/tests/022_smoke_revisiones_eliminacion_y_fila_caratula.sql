SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * Smoke test 022 — migraciones 009 (TR_..._inmutable + bypass por
 * SESSION_CONTEXT) y 010 (fila_caratula fija). Ver CLAUDE.md.
 *
 * No repite lo que ya prueban las 86 aserciones de
 * backend/tests/entregablesLdi.api.test.ts contra un backend real (esas
 * SÍ ejercitan el endpoint completo, incluida la corrección de
 * CK_revision_entregable_emitida_completa al nulear archivo_id) — esto
 * verifica la garantía a nivel de motor: el bypass NUNCA queda "prendido"
 * fuera de su propia transacción/statement, y el CHECK de rango de
 * fila_caratula funciona.
 */

DECLARE @cliente_id BIGINT;
DECLARE @proyecto1_id BIGINT;
DECLARE @tipo_ldi_id BIGINT;
DECLARE @usuario_id BIGINT;

SELECT @proyecto1_id = id, @cliente_id = cliente_id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001' AND activo = 1;

IF @proyecto1_id IS NULL
    THROW 52201, 'No existe TEST-001.', 1;

SELECT @tipo_ldi_id = id FROM cat.cat_tipo_entregable WHERE codigo = N'LDI';

IF @tipo_ldi_id IS NULL
    THROW 52201, 'No existe el tipo de entregable LDI (correr 006_entregables_base.sql).', 1;

SELECT TOP (1) @usuario_id = id FROM seguridad.usuario;

IF @usuario_id IS NULL
    THROW 52201, 'No existe ningun seguridad.usuario para usar como emitida_by.', 1;

PRINT '=========================================';
PRINT 'TEST 022 - REVISIONES: ELIMINACION DEFINITIVA (009) + FILA_CARATULA FIJA (010)';
PRINT '=========================================';


/* ============================================================
   Helper repetido en cada caso: arma un entregable + revision EMITIDA
   completa (satisface CK_revision_entregable_emitida_completa), lista
   para los casos de abajo.
   ============================================================ */


/* ============================================================
   CASO 1
   CK_revision_entregable_fila_caratula_rango: fuera de [32,36] se
   rechaza; NULL y los dos extremos (32 y 36) se aceptan.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @entregable1_id BIGINT;
    DECLARE @revision1_id BIGINT;

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST022-LDI-0001', N'LDI', N'0001');
    SET @entregable1_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable (proyecto_id, entregable_id, codigo_revision, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, estado, fila_caratula)
    VALUES (@proyecto1_id, @entregable1_id, N'A', N'Test 022', N'X.X.X.', N'Y.Y.Y.', N'Z.Z.Z.', N'BORRADOR', NULL);
    SET @revision1_id = SCOPE_IDENTITY();

    UPDATE nucleo.revision_entregable SET fila_caratula = 36 WHERE id = @revision1_id;
    UPDATE nucleo.revision_entregable SET fila_caratula = 32 WHERE id = @revision1_id;

    PRINT 'PASS 1a: NULL, 32 y 36 son valores validos para fila_caratula.';

    -- Ahora el valor fuera de rango, que debe fallar.
    UPDATE nucleo.revision_entregable SET fila_caratula = 37 WHERE id = @revision1_id;

    PRINT 'FAIL 1b: SQL Server permitio fila_caratula = 37 (fuera de [32,36]).';

    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error1 NVARCHAR(4000) = ERROR_MESSAGE();
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

    IF @error1 LIKE N'%CK_revision_entregable_fila_caratula_rango%'
        PRINT 'PASS 1b: SQL Server rechazo fila_caratula = 37.';
    ELSE
    BEGIN
        PRINT 'FAIL 1b: se produjo un error distinto al esperado.';
        PRINT @error1;
    END
END CATCH;


/* ============================================================
   CASO 2
   Sin el bypass (SESSION_CONTEXT en 0 o sin fijar), el trigger de
   inmutabilidad de estado sigue rechazando el UPDATE normal de una
   EMITIDA — la migracion 009 no debilito la proteccion por defecto.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    EXEC sp_set_session_context @key = N'siei_bypass_inmutabilidad_revision', @value = 0;

    DECLARE @entregable2_id BIGINT;
    DECLARE @revision2_id BIGINT;
    DECLARE @archivo2_id BIGINT;
    DECLARE @plantilla2_id BIGINT;

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST022-LDI-0002', N'LDI', N'0002');
    SET @entregable2_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable (proyecto_id, entregable_id, codigo_revision, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, estado)
    VALUES (@proyecto1_id, @entregable2_id, N'A', N'Test 022', N'X.X.X.', N'Y.Y.Y.', N'Z.Z.Z.', N'BORRADOR');
    SET @revision2_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable_archivo (proyecto_id, revision_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes)
    VALUES (@proyecto1_id, @revision2_id, N'test022b.xlsx', 0x1234, REPLICATE('a', 64), 2);
    SET @archivo2_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plantilla_entregable (proyecto_id, tipo_entregable_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'plantilla022b.xlsm', 0xABCD, REPLICATE('1', 64), 2);
    SET @plantilla2_id = SCOPE_IDENTITY();

    UPDATE nucleo.revision_entregable
    SET estado = N'EMITIDA', archivo_id = @archivo2_id, emitida_by = @usuario_id, emitida_at = SYSUTCDATETIME(),
        metadatos_snapshot_json = N'{}', criterios_aplicados_json = N'[]', plantilla_id = @plantilla2_id, fila_caratula = 36
    WHERE id = @revision2_id;

    -- Sin bypass: debe rechazarse igual que antes de la migracion 009.
    UPDATE nucleo.revision_entregable SET descripcion = N'Intento sin bypass' WHERE id = @revision2_id;

    PRINT 'FAIL 2: SQL Server permitio editar una EMITIDA sin el bypass activo.';

    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error2 NVARCHAR(4000) = ERROR_MESSAGE();
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

    IF @error2 LIKE N'%estado final%'
        PRINT 'PASS 2: sin el bypass, una EMITIDA sigue siendo inmutable (la migracion 009 no debilito la proteccion por defecto).';
    ELSE
    BEGIN
        PRINT 'FAIL 2: se produjo un error distinto al esperado.';
        PRINT @error2;
    END
END CATCH;


/* ============================================================
   CASO 3
   Con el bypass en 1, el UPDATE sobre una EMITIDA SI se permite; al
   apagarlo (valor 0) DENTRO DE LA MISMA TRANSACCION, un UPDATE
   posterior vuelve a rechazarse — el bypass no "queda prendido" una
   vez que el codigo lo apaga.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @entregable3_id BIGINT;
    DECLARE @revision3_id BIGINT;
    DECLARE @archivo3_id BIGINT;
    DECLARE @plantilla3_id BIGINT;

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST022-LDI-0003', N'LDI', N'0003');
    SET @entregable3_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable (proyecto_id, entregable_id, codigo_revision, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, estado)
    VALUES (@proyecto1_id, @entregable3_id, N'A', N'Test 022', N'X.X.X.', N'Y.Y.Y.', N'Z.Z.Z.', N'BORRADOR');
    SET @revision3_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable_archivo (proyecto_id, revision_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes)
    VALUES (@proyecto1_id, @revision3_id, N'test022c.xlsx', 0x1234, REPLICATE('b', 64), 2);
    SET @archivo3_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plantilla_entregable (proyecto_id, tipo_entregable_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'plantilla022c.xlsm', 0xABCD, REPLICATE('2', 64), 2);
    SET @plantilla3_id = SCOPE_IDENTITY();

    UPDATE nucleo.revision_entregable
    SET estado = N'EMITIDA', archivo_id = @archivo3_id, emitida_by = @usuario_id, emitida_at = SYSUTCDATETIME(),
        metadatos_snapshot_json = N'{}', criterios_aplicados_json = N'[]', plantilla_id = @plantilla3_id, fila_caratula = 35
    WHERE id = @revision3_id;

    EXEC sp_set_session_context @key = N'siei_bypass_inmutabilidad_revision', @value = 1;

    -- Con bypass=1: el update SI debe pasar (esto es lo que usa el
    -- endpoint de emitir para correr fila_caratula de otras EMITIDA).
    UPDATE nucleo.revision_entregable SET fila_caratula = 34 WHERE id = @revision3_id;

    IF (SELECT fila_caratula FROM nucleo.revision_entregable WHERE id = @revision3_id) <> 34
        THROW 52202, 'El UPDATE con bypass=1 no se aplico.', 1;

    PRINT 'PASS 3a: con bypass=1, el UPDATE sobre una EMITIDA se permite.';

    EXEC sp_set_session_context @key = N'siei_bypass_inmutabilidad_revision', @value = 0;

    -- Bypass apagado otra vez: debe volver a rechazarse, en la MISMA transaccion/conexion.
    UPDATE nucleo.revision_entregable SET descripcion = N'Intento tras apagar el bypass' WHERE id = @revision3_id;

    PRINT 'FAIL 3b: el bypass siguio activo despues de apagarlo (SESSION_CONTEXT quedo "prendido").';

    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error3 NVARCHAR(4000) = ERROR_MESSAGE();
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

    IF @error3 LIKE N'%estado final%'
        PRINT 'PASS 3b: al apagar el bypass, la proteccion vuelve a aplicarse de inmediato.';
    ELSE
    BEGIN
        PRINT 'FAIL 3b: se produjo un error distinto al esperado (o el CATCH disparo por el THROW 52202 del paso previo).';
        PRINT @error3;
    END
END CATCH;


/* ============================================================
   CASO 4
   Eliminacion fisica completa de una revision EMITIDA replicando
   exactamente la secuencia del endpoint DELETE (migracion 009):
   archivo_id=NULL + estado='BORRADOR' (para no chocar con
   CK_revision_entregable_emitida_completa) -> borrar archivo -> borrar
   fila -> borrar la revision -> apagar el bypass. Se hace con ROLLBACK
   al final para no dejar residuos permanentes en TEST-001 (a
   diferencia del backend real, que si hace COMMIT).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @entregable4_id BIGINT;
    DECLARE @revision4_id BIGINT;
    DECLARE @instrumento4_id BIGINT;
    DECLARE @fila4_id BIGINT;
    DECLARE @archivo4_id BIGINT;
    DECLARE @plantilla4_id BIGINT;

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST022-LDI-0004', N'LDI', N'0004');
    SET @entregable4_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable (proyecto_id, entregable_id, codigo_revision, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, estado)
    VALUES (@proyecto1_id, @entregable4_id, N'A', N'Test 022', N'X.X.X.', N'Y.Y.Y.', N'Z.Z.Z.', N'BORRADOR');
    SET @revision4_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento)
    VALUES (@proyecto1_id, N'PIT-022-A');
    SET @instrumento4_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable_fila (proyecto_id, revision_id, instrumento_id, item, datos_snapshot)
    VALUES (@proyecto1_id, @revision4_id, @instrumento4_id, 1, N'{"tag":"PIT-022-A"}');
    SET @fila4_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable_archivo (proyecto_id, revision_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes)
    VALUES (@proyecto1_id, @revision4_id, N'test022d.xlsx', 0x1234, REPLICATE('c', 64), 2);
    SET @archivo4_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plantilla_entregable (proyecto_id, tipo_entregable_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'plantilla022d.xlsm', 0xABCD, REPLICATE('3', 64), 2);
    SET @plantilla4_id = SCOPE_IDENTITY();

    UPDATE nucleo.revision_entregable
    SET estado = N'EMITIDA', archivo_id = @archivo4_id, emitida_by = @usuario_id, emitida_at = SYSUTCDATETIME(),
        metadatos_snapshot_json = N'{}', criterios_aplicados_json = N'[]', plantilla_id = @plantilla4_id, fila_caratula = 36
    WHERE id = @revision4_id;

    EXEC sp_set_session_context @key = N'siei_bypass_inmutabilidad_revision', @value = 1;

    UPDATE nucleo.revision_entregable SET archivo_id = NULL, estado = N'BORRADOR' WHERE id = @revision4_id;
    DELETE FROM nucleo.revision_entregable_archivo WHERE id = @archivo4_id;
    DELETE FROM nucleo.revision_entregable_fila WHERE id = @fila4_id;
    DELETE FROM nucleo.revision_entregable WHERE id = @revision4_id;

    EXEC sp_set_session_context @key = N'siei_bypass_inmutabilidad_revision', @value = 0;

    IF EXISTS (SELECT 1 FROM nucleo.revision_entregable WHERE id = @revision4_id)
        THROW 52203, 'La revision sigue existiendo tras el borrado fisico.', 1;
    IF EXISTS (SELECT 1 FROM nucleo.revision_entregable_fila WHERE id = @fila4_id)
        THROW 52203, 'La fila sigue existiendo tras el borrado fisico.', 1;
    IF EXISTS (SELECT 1 FROM nucleo.revision_entregable_archivo WHERE id = @archivo4_id)
        THROW 52203, 'El archivo sigue existiendo tras el borrado fisico.', 1;

    PRINT 'PASS 4: borrado fisico completo de una EMITIDA (revision + fila + archivo) via el bypass, en el mismo orden que usa el endpoint real.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error4 NVARCHAR(4000) = ERROR_MESSAGE();
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 4: se produjo un error inesperado durante el borrado fisico.';
    PRINT @error4;
END CATCH;
