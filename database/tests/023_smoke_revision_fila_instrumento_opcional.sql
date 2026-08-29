SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * Smoke test 023 — migracion 011:
 * revision_entregable_fila.instrumento_id opcional + indice unico
 * filtrado (reemplaza la UNIQUE constraint original, que en SQL Server
 * solo admite una fila con NULL por combinacion de columnas).
 *
 * No repite lo que ya prueba backend/tests/instrumentoEliminacionDefinitiva.
 * api.test.ts contra un backend real (esa suite SI ejercita el endpoint
 * completo, incluido el bypass de SESSION_CONTEXT sobre una revision
 * EMITIDA) — esto verifica la garantia a nivel de motor: la columna
 * admite NULL, y DOS filas de la MISMA revision pueden tener
 * instrumento_id = NULL a la vez sin violar unicidad.
 */

DECLARE @proyecto1_id BIGINT;
DECLARE @tipo_ldi_id BIGINT;

SELECT @proyecto1_id = id FROM nucleo.proyecto WHERE codigo_proyecto = N'TEST-001' AND activo = 1;
IF @proyecto1_id IS NULL THROW 52301, 'No existe TEST-001.', 1;

SELECT @tipo_ldi_id = id FROM cat.cat_tipo_entregable WHERE codigo = N'LDI';
IF @tipo_ldi_id IS NULL THROW 52301, 'No existe el tipo de entregable LDI (correr 006_entregables_base.sql).', 1;

PRINT '=========================================';
PRINT 'TEST 023 - revision_entregable_fila.instrumento_id OPCIONAL (migracion 011)';
PRINT '=========================================';


/* ============================================================
   CASO 1
   La columna admite NULL directamente (sin pasar por ningun DELETE
   de instrumento — solo la propiedad de esquema).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @entregable1_id BIGINT;
    DECLARE @revision1_id BIGINT;

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST023-LDI-0001', N'LDI', N'0001');
    SET @entregable1_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable (proyecto_id, entregable_id, codigo_revision, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, estado)
    VALUES (@proyecto1_id, @entregable1_id, N'A', N'Test 023', N'X.X.X.', N'Y.Y.Y.', N'Z.Z.Z.', N'BORRADOR');
    SET @revision1_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable_fila (proyecto_id, revision_id, instrumento_id, item, datos_snapshot)
    VALUES (@proyecto1_id, @revision1_id, NULL, 1, N'{"tag":"SIN-INSTRUMENTO-1"}');

    PRINT 'PASS 1: instrumento_id acepta NULL en revision_entregable_fila.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 1: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2
   DOS filas de la MISMA revision con instrumento_id = NULL a la vez
   -> no debe violar ninguna restriccion de unicidad (el indice
   filtrado UX_revision_entregable_fila_instrumento excluye los NULL).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @entregable2_id BIGINT;
    DECLARE @revision2_id BIGINT;

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST023-LDI-0002', N'LDI', N'0002');
    SET @entregable2_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable (proyecto_id, entregable_id, codigo_revision, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, estado)
    VALUES (@proyecto1_id, @entregable2_id, N'A', N'Test 023', N'X.X.X.', N'Y.Y.Y.', N'Z.Z.Z.', N'BORRADOR');
    SET @revision2_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable_fila (proyecto_id, revision_id, instrumento_id, item, datos_snapshot)
    VALUES (@proyecto1_id, @revision2_id, NULL, 1, N'{"tag":"SIN-INSTRUMENTO-A"}');

    INSERT INTO nucleo.revision_entregable_fila (proyecto_id, revision_id, instrumento_id, item, datos_snapshot)
    VALUES (@proyecto1_id, @revision2_id, NULL, 2, N'{"tag":"SIN-INSTRUMENTO-B"}');

    PRINT 'PASS 2: dos filas de la misma revision con instrumento_id = NULL conviven sin violar unicidad.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 2: se produjo un error inesperado (revisar UX_revision_entregable_fila_instrumento).';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3
   El indice filtrado SI sigue exigiendo unicidad (revision_id,
   instrumento_id) cuando instrumento_id NO es NULL — no se perdio
   la garantia original al reemplazar la UNIQUE constraint.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @entregable3_id BIGINT;
    DECLARE @revision3_id BIGINT;
    DECLARE @instrumento3_id BIGINT;

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento)
    VALUES (@proyecto1_id, N'PIT-023-A');
    SET @instrumento3_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.entregable (proyecto_id, tipo_entregable_id, numero_documento, componente_tipo, componente_correlativo)
    VALUES (@proyecto1_id, @tipo_ldi_id, N'TEST023-LDI-0003', N'LDI', N'0003');
    SET @entregable3_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable (proyecto_id, entregable_id, codigo_revision, descripcion, iniciales_por, iniciales_revisado, iniciales_aprobado, estado)
    VALUES (@proyecto1_id, @entregable3_id, N'A', N'Test 023', N'X.X.X.', N'Y.Y.Y.', N'Z.Z.Z.', N'BORRADOR');
    SET @revision3_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.revision_entregable_fila (proyecto_id, revision_id, instrumento_id, item, datos_snapshot)
    VALUES (@proyecto1_id, @revision3_id, @instrumento3_id, 1, N'{"tag":"PIT-023-A"}');

    -- Mismo instrumento, misma revision, otro item -> debe rechazarse.
    INSERT INTO nucleo.revision_entregable_fila (proyecto_id, revision_id, instrumento_id, item, datos_snapshot)
    VALUES (@proyecto1_id, @revision3_id, @instrumento3_id, 2, N'{"tag":"PIT-023-A-dup"}');

    PRINT 'FAIL 3: SQL Server permitio el mismo instrumento dos veces en la misma revision.';

    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error3 NVARCHAR(4000) = ERROR_MESSAGE();
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;

    IF @error3 LIKE N'%UX_revision_entregable_fila_instrumento%'
        PRINT 'PASS 3: el indice filtrado sigue rechazando el mismo instrumento repetido en una revision.';
    ELSE
    BEGIN
        PRINT 'FAIL 3: se produjo un error distinto al esperado.';
        PRINT @error3;
    END
END CATCH;
