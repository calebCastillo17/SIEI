SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @cliente_id BIGINT;
DECLARE @proyecto1_id BIGINT;
DECLARE @proyecto2_id BIGINT;
DECLARE @tipo_ldi_id BIGINT;
DECLARE @usuario_id BIGINT;

SELECT @proyecto1_id = id, @cliente_id = cliente_id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001' AND activo = 1;

IF @proyecto1_id IS NULL
    THROW 52001, 'No existe TEST-001.', 1;

SELECT @tipo_ldi_id = id FROM cat.cat_tipo_entregable WHERE codigo = N'LDI';

IF @tipo_ldi_id IS NULL
    THROW 52001, 'No existe el tipo de entregable LDI (correr 006_entregables_base.sql).', 1;

-- emitida_by es NOT NULL cuando estado=EMITIDA (CK_revision_entregable_emitida_completa)
-- — hace falta un usuario real, cualquiera sirve para este smoke test.
SELECT TOP (1) @usuario_id = id FROM seguridad.usuario;

IF @usuario_id IS NULL
    THROW 52001, 'No existe ningun seguridad.usuario para usar como emitida_by.', 1;

-- Proyecto temporal propio para el caso de aislamiento multiproyecto —
-- descartado con ROLLBACK dentro de ese mismo caso.
PRINT '=========================================';
PRINT 'TEST 020 - ENTREGABLES / LDI (migracion 006)';
PRINT '=========================================';


/* ============================================================
   CASO 1
   FLUJO BASICO: entregable -> revision BORRADOR -> fila -> emitir
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @entregable1_id BIGINT;
    DECLARE @revision1_id BIGINT;
    DECLARE @instrumento1_id BIGINT;
    DECLARE @archivo1_id BIGINT;
    DECLARE @plantilla1_id BIGINT;

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST020-LDI-0001', N'LDI', N'0001');
    SET @entregable1_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable (proyecto_id, entregable_id, codigo_revision, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, estado)
    VALUES (@proyecto1_id, @entregable1_id, N'A', N'Test 020', N'X.X.X.', N'Y.Y.Y.', N'Z.Z.Z.', N'BORRADOR');
    SET @revision1_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento)
    VALUES (@proyecto1_id, N'PIT-020-A');
    SET @instrumento1_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable_fila (proyecto_id, revision_id, instrumento_id, item, datos_snapshot)
    VALUES (@proyecto1_id, @revision1_id, @instrumento1_id, 1, N'{"tag":"PIT-020-A"}');

    INSERT INTO nucleo.revision_entregable_archivo (proyecto_id, revision_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes)
    VALUES (@proyecto1_id, @revision1_id, N'test020.xlsx', 0x1234, REPLICATE('a', 64), 2);
    SET @archivo1_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plantilla_entregable (proyecto_id, tipo_entregable_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'plantilla020a.xlsm', 0xABCD, REPLICATE('1', 64), 2);
    SET @plantilla1_id = SCOPE_IDENTITY();

    UPDATE nucleo.revision_entregable
    SET estado = N'EMITIDA', archivo_id = @archivo1_id, emitida_by = @usuario_id, emitida_at = SYSUTCDATETIME(),
        metadatos_snapshot_json = N'{}', criterios_aplicados_json = N'[]', plantilla_id = @plantilla1_id
    WHERE id = @revision1_id;

    PRINT 'PASS 1: flujo basico entregable -> BORRADOR -> fila -> archivo -> EMITIDA.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 1: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2
   UNA REVISION EMITIDA ES INMUTABLE
   (TR_revision_entregable_estado_final_inmutable)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @entregable2_id BIGINT;
    DECLARE @revision2_id BIGINT;
    DECLARE @archivo2_id BIGINT;
    DECLARE @plantilla2_id BIGINT;

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST020-LDI-0002', N'LDI', N'0002');
    SET @entregable2_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable (proyecto_id, entregable_id, codigo_revision, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, estado)
    VALUES (@proyecto1_id, @entregable2_id, N'A', N'Test 020', N'X.X.X.', N'Y.Y.Y.', N'Z.Z.Z.', N'BORRADOR');
    SET @revision2_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable_archivo (proyecto_id, revision_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes)
    VALUES (@proyecto1_id, @revision2_id, N'test020b.xlsx', 0x1234, REPLICATE('b', 64), 2);
    SET @archivo2_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plantilla_entregable (proyecto_id, tipo_entregable_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'plantilla020b.xlsm', 0xABCD, REPLICATE('2', 64), 2);
    SET @plantilla2_id = SCOPE_IDENTITY();

    UPDATE nucleo.revision_entregable
    SET estado = N'EMITIDA', archivo_id = @archivo2_id, emitida_by = @usuario_id, emitida_at = SYSUTCDATETIME(),
        metadatos_snapshot_json = N'{}', criterios_aplicados_json = N'[]', plantilla_id = @plantilla2_id
    WHERE id = @revision2_id;

    -- Ahora intentar editarla: debe rechazarse.
    UPDATE nucleo.revision_entregable SET descripcion = N'Intento de edicion' WHERE id = @revision2_id;

    PRINT 'FAIL 2: SQL Server permitio editar una revision EMITIDA.';

    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error2 NVARCHAR(4000) = ERROR_MESSAGE();
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

    IF @error2 LIKE N'%estado final%'
        PRINT 'PASS 2: SQL Server rechazo editar una revision EMITIDA.';
    ELSE
    BEGIN
        PRINT 'FAIL 2: se produjo un error distinto al esperado.';
        PRINT @error2;
    END
END CATCH;


/* ============================================================
   CASO 3
   NO SE PUEDE TOCAR revision_entregable_fila DE UNA REVISION EMITIDA
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @entregable3_id BIGINT;
    DECLARE @revision3_id BIGINT;
    DECLARE @instrumento3_id BIGINT;
    DECLARE @fila3_id BIGINT;
    DECLARE @archivo3_id BIGINT;
    DECLARE @plantilla3_id BIGINT;

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST020-LDI-0003', N'LDI', N'0003');
    SET @entregable3_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable (proyecto_id, entregable_id, codigo_revision, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, estado)
    VALUES (@proyecto1_id, @entregable3_id, N'A', N'Test 020', N'X.X.X.', N'Y.Y.Y.', N'Z.Z.Z.', N'BORRADOR');
    SET @revision3_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento)
    VALUES (@proyecto1_id, N'PIT-020-C');
    SET @instrumento3_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable_fila (proyecto_id, revision_id, instrumento_id, item, datos_snapshot)
    VALUES (@proyecto1_id, @revision3_id, @instrumento3_id, 1, N'{"tag":"PIT-020-C"}');
    SET @fila3_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable_archivo (proyecto_id, revision_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes)
    VALUES (@proyecto1_id, @revision3_id, N'test020c.xlsx', 0x1234, REPLICATE('c', 64), 2);
    SET @archivo3_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plantilla_entregable (proyecto_id, tipo_entregable_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'plantilla020c.xlsm', 0xABCD, REPLICATE('3', 64), 2);
    SET @plantilla3_id = SCOPE_IDENTITY();

    UPDATE nucleo.revision_entregable
    SET estado = N'EMITIDA', archivo_id = @archivo3_id, emitida_by = @usuario_id, emitida_at = SYSUTCDATETIME(),
        metadatos_snapshot_json = N'{}', criterios_aplicados_json = N'[]', plantilla_id = @plantilla3_id
    WHERE id = @revision3_id;

    -- Intentar tocar la fila directamente, sin pasar por el padre.
    UPDATE nucleo.revision_entregable_fila SET datos_snapshot = N'{"tag":"HACKEADO"}' WHERE id = @fila3_id;

    PRINT 'FAIL 3: SQL Server permitio modificar el snapshot de una revision EMITIDA.';

    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error3 NVARCHAR(4000) = ERROR_MESSAGE();
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

    IF @error3 LIKE N'%EMITIDA o DESCARTADA%'
        PRINT 'PASS 3: SQL Server rechazo modificar el snapshot de una revision EMITIDA.';
    ELSE
    BEGIN
        PRINT 'FAIL 3: se produjo un error distinto al esperado.';
        PRINT @error3;
    END
END CATCH;


/* ============================================================
   CASO 4
   EL BLOB DE UNA PLANTILLA NUNCA SE EDITA IN-PLACE
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @plantilla4_id BIGINT;

    INSERT INTO nucleo.plantilla_entregable (proyecto_id, tipo_entregable_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'plantilla020.xlsm', 0xABCD, REPLICATE('d', 64), 2);
    SET @plantilla4_id = SCOPE_IDENTITY();

    UPDATE nucleo.plantilla_entregable SET archivo_blob = 0xFFFF WHERE id = @plantilla4_id;

    PRINT 'FAIL 4: SQL Server permitio editar el blob de una plantilla.';

    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error4 NVARCHAR(4000) = ERROR_MESSAGE();
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

    IF @error4 LIKE N'%plantilla%'
        PRINT 'PASS 4: SQL Server rechazo editar el blob de una plantilla.';
    ELSE
    BEGIN
        PRINT 'FAIL 4: se produjo un error distinto al esperado.';
        PRINT @error4;
    END
END CATCH;


/* ============================================================
   CASO 5
   EL ARCHIVO DE UNA REVISION EMITIDA ES INMUTABLE
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @entregable5_id BIGINT;
    DECLARE @revision5_id BIGINT;
    DECLARE @archivo5_id BIGINT;

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST020-LDI-0005', N'LDI', N'0005');
    SET @entregable5_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable (proyecto_id, entregable_id, codigo_revision, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, estado)
    VALUES (@proyecto1_id, @entregable5_id, N'A', N'Test 020', N'X.X.X.', N'Y.Y.Y.', N'Z.Z.Z.', N'BORRADOR');
    SET @revision5_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable_archivo (proyecto_id, revision_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes)
    VALUES (@proyecto1_id, @revision5_id, N'test020e.xlsx', 0x1234, REPLICATE('e', 64), 2);
    SET @archivo5_id = SCOPE_IDENTITY();

    UPDATE nucleo.revision_entregable_archivo SET archivo_blob = 0xFFFF WHERE id = @archivo5_id;

    PRINT 'FAIL 5: SQL Server permitio editar el archivo de una revision.';

    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error5 NVARCHAR(4000) = ERROR_MESSAGE();
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

    IF @error5 LIKE N'%inmutable%'
        PRINT 'PASS 5: SQL Server rechazo editar el archivo de una revision emitida.';
    ELSE
    BEGIN
        PRINT 'FAIL 5: se produjo un error distinto al esperado.';
        PRINT @error5;
    END
END CATCH;


/* ============================================================
   CASO 6
   AISLAMIENTO MULTIPROYECTO: no se puede congelar en una revision una
   plantilla de OTRO proyecto (FK compuesta)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @proyecto6_id BIGINT;
    DECLARE @plantilla6_otro_proyecto_id BIGINT;
    DECLARE @entregable6_id BIGINT;

    INSERT INTO nucleo.proyecto (cliente_id, codigo_proyecto, nombre)
    VALUES (@cliente_id, N'TEST-020-TMP', N'Proyecto temporal — smoke 020');
    SET @proyecto6_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plantilla_entregable (proyecto_id, tipo_entregable_id, nombre_archivo, archivo_blob, archivo_hash, tamanio_bytes)
    VALUES (@proyecto6_id, @tipo_ldi_id, N'plantilla_otro_proyecto.xlsm', 0xAAAA, REPLICATE('f', 64), 2);
    SET @plantilla6_otro_proyecto_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST020-LDI-0006', N'LDI', N'0006');
    SET @entregable6_id = SCOPE_IDENTITY();

    -- @proyecto1_id != @proyecto6_id: la FK compuesta (plantilla_id, proyecto_id) debe rechazar esto.
    INSERT INTO nucleo.revision_entregable (proyecto_id, entregable_id, codigo_revision, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, estado, plantilla_id)
    VALUES (@proyecto1_id, @entregable6_id, N'A', N'Test 020', N'X.X.X.', N'Y.Y.Y.', N'Z.Z.Z.', N'BORRADOR', @plantilla6_otro_proyecto_id);

    PRINT 'FAIL 6: SQL Server permitio congelar una plantilla de otro proyecto.';

    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error6 NVARCHAR(4000) = ERROR_MESSAGE();
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

    IF @error6 LIKE N'%FK_revision_entregable_plantilla%'
        PRINT 'PASS 6: SQL Server rechazo la plantilla cruzada entre proyectos.';
    ELSE
    BEGIN
        PRINT 'FAIL 6: se produjo un error distinto al esperado.';
        PRINT @error6;
    END
END CATCH;


/* ============================================================
   CASO 7
   CK_revision_entregable_emitida_completa: no se puede marcar EMITIDA
   sin archivo/plantilla/criterios/metadatos
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @entregable7_id BIGINT;
    DECLARE @revision7_id BIGINT;

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST020-LDI-0007', N'LDI', N'0007');
    SET @entregable7_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable (proyecto_id, entregable_id, codigo_revision, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, estado)
    VALUES (@proyecto1_id, @entregable7_id, N'A', N'Test 020', N'X.X.X.', N'Y.Y.Y.', N'Z.Z.Z.', N'BORRADOR');
    SET @revision7_id = SCOPE_IDENTITY();

    UPDATE nucleo.revision_entregable SET estado = N'EMITIDA' WHERE id = @revision7_id;

    PRINT 'FAIL 7: SQL Server permitio EMITIDA sin archivo/plantilla/criterios/metadatos.';

    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error7 NVARCHAR(4000) = ERROR_MESSAGE();
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

    IF @error7 LIKE N'%CK_revision_entregable_emitida_completa%'
        PRINT 'PASS 7: SQL Server rechazo EMITIDA incompleta.';
    ELSE
    BEGIN
        PRINT 'FAIL 7: se produjo un error distinto al esperado.';
        PRINT @error7;
    END
END CATCH;


/* ============================================================
   CASO 8
   UQ_revision_entregable_borrador_unico: dos BORRADOR para el mismo
   entregable a la vez
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @entregable8_id BIGINT;

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST020-LDI-0008', N'LDI', N'0008');
    SET @entregable8_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable (proyecto_id, entregable_id, codigo_revision, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, estado)
    VALUES (@proyecto1_id, @entregable8_id, N'A', N'Test 020', N'X.X.X.', N'Y.Y.Y.', N'Z.Z.Z.', N'BORRADOR');

    INSERT INTO nucleo.revision_entregable (proyecto_id, entregable_id, codigo_revision, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, estado)
    VALUES (@proyecto1_id, @entregable8_id, N'B', N'Test 020 bis', N'X.X.X.', N'Y.Y.Y.', N'Z.Z.Z.', N'BORRADOR');

    PRINT 'FAIL 8: SQL Server permitio dos BORRADOR para el mismo entregable.';

    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error8 NVARCHAR(4000) = ERROR_MESSAGE();
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

    IF @error8 LIKE N'%UX_revision_entregable_borrador_unico%'
        PRINT 'PASS 8: SQL Server rechazo un segundo BORRADOR simultaneo.';
    ELSE
    BEGIN
        PRINT 'FAIL 8: se produjo un error distinto al esperado.';
        PRINT @error8;
    END
END CATCH;


/* ============================================================
   CASO 9
   UQ_entregable_numero_documento: numero de documento repetido en el
   mismo proyecto
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST020-LDI-DUP', N'LDI', N'DUP1');

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST020-LDI-DUP', N'LDI', N'DUP2');

    PRINT 'FAIL 9: SQL Server permitio numero_documento duplicado en el mismo proyecto.';

    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error9 NVARCHAR(4000) = ERROR_MESSAGE();
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

    IF @error9 LIKE N'%UQ_entregable_numero_documento%'
        PRINT 'PASS 9: SQL Server rechazo numero_documento duplicado.';
    ELSE
    BEGIN
        PRINT 'FAIL 9: se produjo un error distinto al esperado.';
        PRINT @error9;
    END
END CATCH;
