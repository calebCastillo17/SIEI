SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @proyecto1_id BIGINT;
DECLARE @cliente_id BIGINT;
DECLARE @estado_nuevo_id BIGINT;
DECLARE @estado_ok_id BIGINT;

SELECT @proyecto1_id = id,
       @cliente_id = cliente_id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

IF @proyecto1_id IS NULL
    THROW 52001, 'No existe TEST-001.', 1;

SELECT @estado_nuevo_id = id FROM cat.cat_estado_pnid WHERE codigo = N'NUEVO_EN_PNID';
SELECT @estado_ok_id = id FROM cat.cat_estado_pnid WHERE codigo = N'OK';

PRINT '=========================================';
PRINT 'TEST 018 - IMPORTACION PNID (migracion 004)';
PRINT '=========================================';


/* ============================================================
   CASO 1
   cat.cat_estado_pnid TIENE LOS 2 CODIGOS NUEVOS
   ============================================================ */

IF EXISTS (SELECT 1 FROM cat.cat_estado_pnid WHERE codigo = N'DATOS_MODIFICADOS')
   AND EXISTS (SELECT 1 FROM cat.cat_estado_pnid WHERE codigo = N'REQUIERE_REVISION')
BEGIN
    PRINT 'PASS 1: DATOS_MODIFICADOS y REQUIERE_REVISION existen en cat.cat_estado_pnid.';
END
ELSE
BEGIN
    PRINT 'FAIL 1: faltan codigos nuevos en cat.cat_estado_pnid.';
END


/* ============================================================
   CASO 2
   importacion_pnid.estado FUERA DE LA LISTA PERMITIDA
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO integracion.importacion_pnid
        (proyecto_id, nombre_archivo, hash_archivo, estado, total_filas, total_listado_true)
    VALUES
        (@proyecto1_id, N'test018.xlsx', REPLICATE('a', 64), N'ESTADO_INVENTADO', 1, 1);

    PRINT 'FAIL 2: SQL Server permitio un estado fuera de la lista permitida.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error2 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error2 LIKE N'%CK_importacion_pnid_estado%'
        PRINT 'PASS 2: SQL Server rechazo un estado invalido de importacion_pnid.';
    ELSE
    BEGIN
        PRINT 'FAIL 2: se produjo un error distinto al esperado.';
        PRINT @error2;
    END
END CATCH;


/* ============================================================
   CASO 3
   importacion_pnid_fila.datos_fuente CON JSON INVALIDO
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @importacion3_id BIGINT;

    INSERT INTO integracion.importacion_pnid
        (proyecto_id, nombre_archivo, hash_archivo, estado, total_filas, total_listado_true)
    VALUES
        (@proyecto1_id, N'test018.xlsx', REPLICATE('b', 64), N'PREVISUALIZADO', 1, 1);

    SET @importacion3_id = SCOPE_IDENTITY();

    INSERT INTO integracion.importacion_pnid_fila
        (importacion_id, proyecto_id, numero_fila, pnpid, tag_instrumento, listado, datos_fuente)
    VALUES
        (@importacion3_id, @proyecto1_id, 1, N'999901', N'PIT-018-A', 1, N'esto no es json');

    PRINT 'FAIL 3: SQL Server permitio datos_fuente con JSON invalido.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error3 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error3 LIKE N'%CK_importacion_pnid_fila_json%'
        PRINT 'PASS 3: SQL Server rechazo JSON invalido en datos_fuente.';
    ELSE
    BEGIN
        PRINT 'FAIL 3: se produjo un error distinto al esperado.';
        PRINT @error3;
    END
END CATCH;


/* ============================================================
   CASO 4
   importacion_pnid_resultado SIN fila_id NI instrumento_id
   DEBE SER RECHAZADO (CK_importacion_pnid_resultado_origen)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @importacion4_id BIGINT;

    INSERT INTO integracion.importacion_pnid
        (proyecto_id, nombre_archivo, hash_archivo, estado, total_filas, total_listado_true)
    VALUES
        (@proyecto1_id, N'test018.xlsx', REPLICATE('c', 64), N'PREVISUALIZADO', 1, 1);

    SET @importacion4_id = SCOPE_IDENTITY();

    INSERT INTO integracion.importacion_pnid_resultado
        (importacion_id, proyecto_id, fila_id, instrumento_id, resultado_id)
    VALUES
        (@importacion4_id, @proyecto1_id, NULL, NULL, @estado_nuevo_id);

    PRINT 'FAIL 4: SQL Server permitio un resultado sin fila_id ni instrumento_id.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error4 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error4 LIKE N'%CK_importacion_pnid_resultado_origen%'
        PRINT 'PASS 4: SQL Server rechazo un resultado sin fila_id ni instrumento_id.';
    ELSE
    BEGIN
        PRINT 'FAIL 4: se produjo un error distinto al esperado.';
        PRINT @error4;
    END
END CATCH;


/* ============================================================
   CASO 5
   DOS RESULTADOS PARA LA MISMA (importacion_id, fila_id)
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @importacion5_id BIGINT;
    DECLARE @fila5_id BIGINT;

    INSERT INTO integracion.importacion_pnid
        (proyecto_id, nombre_archivo, hash_archivo, estado, total_filas, total_listado_true)
    VALUES
        (@proyecto1_id, N'test018.xlsx', REPLICATE('d', 64), N'PREVISUALIZADO', 1, 1);

    SET @importacion5_id = SCOPE_IDENTITY();

    INSERT INTO integracion.importacion_pnid_fila
        (importacion_id, proyecto_id, numero_fila, pnpid, tag_instrumento, listado, datos_fuente)
    VALUES
        (@importacion5_id, @proyecto1_id, 1, N'999902', N'PIT-018-B', 1, N'{"PnPID":"999902"}');

    SET @fila5_id = SCOPE_IDENTITY();

    INSERT INTO integracion.importacion_pnid_resultado
        (importacion_id, proyecto_id, fila_id, resultado_id)
    VALUES
        (@importacion5_id, @proyecto1_id, @fila5_id, @estado_nuevo_id);

    INSERT INTO integracion.importacion_pnid_resultado
        (importacion_id, proyecto_id, fila_id, resultado_id)
    VALUES
        (@importacion5_id, @proyecto1_id, @fila5_id, @estado_nuevo_id);

    PRINT 'FAIL 5: SQL Server permitio dos resultados para la misma fila dentro del mismo batch.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error5 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error5 LIKE N'%UX_importacion_pnid_resultado_fila%'
        PRINT 'PASS 5: SQL Server rechazo dos resultados para la misma fila.';
    ELSE
    BEGIN
        PRINT 'FAIL 5: se produjo un error distinto al esperado.';
        PRINT @error5;
    END
END CATCH;


/* ============================================================
   CASO 6
   DOS RESULTADOS PARA EL MISMO (importacion_id, instrumento_id)
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @importacion6_id BIGINT;
    DECLARE @instrumento6_id BIGINT;

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, pnpid, fuente_pnpid, estado_pnid_id)
    VALUES
        (@proyecto1_id, N'PIT-018-C', N'999903', N'PLANT3D', @estado_ok_id);

    SET @instrumento6_id = SCOPE_IDENTITY();

    INSERT INTO integracion.importacion_pnid
        (proyecto_id, nombre_archivo, hash_archivo, estado, total_filas, total_listado_true)
    VALUES
        (@proyecto1_id, N'test018.xlsx', REPLICATE('e', 64), N'PREVISUALIZADO', 1, 1);

    SET @importacion6_id = SCOPE_IDENTITY();

    INSERT INTO integracion.importacion_pnid_resultado
        (importacion_id, proyecto_id, instrumento_id, resultado_id)
    VALUES
        (@importacion6_id, @proyecto1_id, @instrumento6_id, @estado_ok_id);

    INSERT INTO integracion.importacion_pnid_resultado
        (importacion_id, proyecto_id, instrumento_id, resultado_id)
    VALUES
        (@importacion6_id, @proyecto1_id, @instrumento6_id, @estado_ok_id);

    PRINT 'FAIL 6: SQL Server permitio dos resultados para el mismo instrumento dentro del mismo batch.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error6 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error6 LIKE N'%UX_importacion_pnid_resultado_instrumento%'
        PRINT 'PASS 6: SQL Server rechazo dos resultados para el mismo instrumento.';
    ELSE
    BEGIN
        PRINT 'FAIL 6: se produjo un error distinto al esperado.';
        PRINT @error6;
    END
END CATCH;


/* ============================================================
   CASO 7
   AISLAMIENTO MULTIPROYECTO: equipo_asociado_id DE OTRO PROYECTO
   DEBE SER RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @proyecto7_id BIGINT;
    DECLARE @equipo7_id BIGINT;

    INSERT INTO nucleo.proyecto
        (cliente_id, codigo_proyecto, nombre)
    VALUES
        (@cliente_id, N'TEST-018', N'Proyecto temporal test 018');

    SET @proyecto7_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.equipo
        (proyecto_id, tag_equipo)
    VALUES
        (@proyecto7_id, N'EQ-018-OTRO-PROYECTO');

    SET @equipo7_id = SCOPE_IDENTITY();

    -- @equipo7_id pertenece a @proyecto7_id, pero el instrumento es de @proyecto1_id.
    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, equipo_asociado_id)
    VALUES
        (@proyecto1_id, N'PIT-018-D', @equipo7_id);

    PRINT 'FAIL 7: SQL Server permitio equipo_asociado_id de otro proyecto.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error7 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error7 LIKE N'%FK_instrumento_equipo_asociado%'
        PRINT 'PASS 7: SQL Server rechazo equipo_asociado_id perteneciente a otro proyecto.';
    ELSE
    BEGIN
        PRINT 'FAIL 7: se produjo un error distinto al esperado.';
        PRINT @error7;
    END
END CATCH;


/* ============================================================
   CASO 8
   FLUJO COMPLETO VALIDO: cabecera + fila + resultado, con
   equipo_asociado_id resuelto correctamente dentro del mismo
   proyecto. Se hace ROLLBACK al final (no deja residuo).
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @importacion8_id BIGINT;
    DECLARE @fila8_id BIGINT;
    DECLARE @equipo8_id BIGINT;
    DECLARE @instrumento8_id BIGINT;

    INSERT INTO nucleo.equipo
        (proyecto_id, tag_equipo)
    VALUES
        (@proyecto1_id, N'EQ-018-VALIDO');

    SET @equipo8_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.instrumento
        (proyecto_id, tag_instrumento, equipo_asociado_id, equipo_asociado_tag,
         tag_anterior, tecnologia, funcionamiento, cuerpo_instrumento,
         conexion_proceso, plano_pnid, linea_pnid, tipo_senal_pnid)
    VALUES
        (@proyecto1_id, N'PIT-018-E', @equipo8_id, N'EQ-018-VALIDO',
         N'PIT-018-ANTERIOR', N'PIEZORRESISTIVO', N'ELECTRICO', N'BOLA',
         N'2" BRIDADO', N'620-F-99999', N'620-LINEA-018', N'4 a 20 mA + HART');

    SET @instrumento8_id = SCOPE_IDENTITY();

    INSERT INTO integracion.importacion_pnid
        (proyecto_id, nombre_archivo, hash_archivo, estado, total_filas, total_listado_true,
         advertencias)
    VALUES
        (@proyecto1_id, N'162281-620-Instrument List (test).xlsx', REPLICATE('f', 64),
         N'PREVISUALIZADO', 1, 1,
         N'{"missingKnownColumns":[],"unknownColumns":["Fabricante"]}');

    SET @importacion8_id = SCOPE_IDENTITY();

    INSERT INTO integracion.importacion_pnid_fila
        (importacion_id, proyecto_id, numero_fila, pnpid, tag_instrumento, listado, datos_fuente)
    VALUES
        (@importacion8_id, @proyecto1_id, 1, N'999904', N'PIT-018-E', 1,
         N'{"PnPID":"999904","Tag":"PIT-018-E","Fabricante":"ACME"}');

    SET @fila8_id = SCOPE_IDENTITY();

    INSERT INTO integracion.importacion_pnid_resultado
        (importacion_id, proyecto_id, fila_id, pnpid, tag_instrumento,
         instrumento_id, resultado_id, instrumento_updated_at_preview)
    VALUES
        (@importacion8_id, @proyecto1_id, @fila8_id, N'999904', N'PIT-018-E',
         @instrumento8_id, @estado_nuevo_id, NULL);

    IF (
        SELECT COUNT(*)
        FROM integracion.importacion_pnid_resultado r
        JOIN integracion.importacion_pnid_fila f ON f.id = r.fila_id
        JOIN cat.cat_estado_pnid e ON e.id = r.resultado_id
        WHERE r.importacion_id = @importacion8_id
          AND e.codigo = N'NUEVO_EN_PNID'
          AND f.pnpid = N'999904'
    ) <> 1
        THROW 55910, 'FAIL: el join fila->resultado->estado no devolvio la fila esperada.', 1;

    PRINT 'PASS 8: flujo completo (cabecera + fila + resultado) se inserta y se puede leer correctamente.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL CASO 8.';
    PRINT ERROR_MESSAGE();
END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 018';
PRINT '=========================================';
