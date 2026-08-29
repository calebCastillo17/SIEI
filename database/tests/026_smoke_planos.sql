SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 026 - PLANOS: nucleo.plano, cat.cat_tipo_plano,
 * nucleo.gabinete_plano, nucleo.caja_plano (migracion 014).
 *
 * A diferencia de senal, nucleo.plano/gabinete_plano/caja_plano no tienen
 * ningun trigger propio (solo CHECK/FK/UNIQUE) — no hay riesgo de que un
 * ROLLBACK TRANSACTION interno termine la transaccion completa, pero se
 * mantiene igual el patron de un BEGIN TRY/BEGIN TRANSACTION por caso,
 * consistente con el resto de la suite.
 */

DECLARE @proyecto1_id BIGINT;
DECLARE @proyecto2_id BIGINT;
DECLARE @cliente_id BIGINT;
DECLARE @tipoConexionado_id BIGINT;
DECLARE @tipoLayout_id BIGINT;

SELECT @proyecto1_id = id, @cliente_id = cliente_id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001' AND activo = 1;

IF @proyecto1_id IS NULL
    THROW 52601, 'No existe TEST-001.', 1;

SELECT @tipoConexionado_id = id FROM cat.cat_tipo_plano WHERE codigo = N'CONEXIONADO';
SELECT @tipoLayout_id = id FROM cat.cat_tipo_plano WHERE codigo = N'LAYOUT';

PRINT '=========================================';
PRINT 'TEST 026 - PLANOS (migracion 014)';
PRINT '=========================================';


/* ============================================================
   CASO 1
   cat.cat_tipo_plano TRAE EXACTAMENTE LOS 4 TIPOS APROBADOS
   ============================================================ */

IF (SELECT COUNT(*) FROM cat.cat_tipo_plano WHERE codigo IN (N'CONEXIONADO', N'INTERIOR_GABINETE', N'LAYOUT', N'UNIFILAR')) = 4
   AND (SELECT COUNT(*) FROM cat.cat_tipo_plano) = 4
    PRINT 'PASS 1: cat.cat_tipo_plano tiene exactamente los 4 tipos aprobados.';
ELSE
    PRINT 'FAIL 1: cat.cat_tipo_plano no tiene exactamente esos 4 codigos.';


/* ============================================================
   CASO 2
   CREAR PLANO CON CODIGO -> PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @plano2_id BIGINT;
    INSERT INTO nucleo.plano (proyecto_id, codigo_plano, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'620-J-026001', N'Plano de prueba 026 con codigo', @tipoConexionado_id);
    SET @plano2_id = SCOPE_IDENTITY();

    IF EXISTS (SELECT 1 FROM nucleo.plano WHERE id = @plano2_id AND codigo_plano = N'620-J-026001')
        PRINT 'PASS 2: plano creado con codigo_plano.';
    ELSE
        PRINT 'FAIL 2: no se encontro el plano creado con codigo.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 2: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 3
   CREAR PLANO SIN CODIGO (NULL) -> PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @plano3_id BIGINT;
    INSERT INTO nucleo.plano (proyecto_id, codigo_plano, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, NULL, N'Plano de prueba 026 sin codigo (LAYOUT)', @tipoLayout_id);
    SET @plano3_id = SCOPE_IDENTITY();

    IF EXISTS (SELECT 1 FROM nucleo.plano WHERE id = @plano3_id AND codigo_plano IS NULL)
        PRINT 'PASS 3: plano creado sin codigo_plano (NULL).';
    ELSE
        PRINT 'FAIL 3: no se encontro el plano creado sin codigo.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 3: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 4
   DOS PLANOS ACTIVOS CON EL MISMO CODIGO EN EL MISMO PROYECTO ->
   PERMITIDO (sin UNIQUE, duplicado real 620-J-20039 encontrado
   en el Excel de referencia)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @plano4a_id BIGINT, @plano4b_id BIGINT;
    INSERT INTO nucleo.plano (proyecto_id, codigo_plano, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'620-J-026004', N'Plano 026 duplicado A', @tipoConexionado_id);
    SET @plano4a_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plano (proyecto_id, codigo_plano, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'620-J-026004', N'Plano 026 duplicado B', @tipoLayout_id);
    SET @plano4b_id = SCOPE_IDENTITY();

    PRINT 'PASS 4: dos planos activos con el mismo codigo en el mismo proyecto fueron permitidos.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 4: SQL Server rechazo el codigo_plano duplicado — no deberia haber UNIQUE.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 5
   MISMO CODIGO EN PROYECTOS DISTINTOS -> PERMITIDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.proyecto (cliente_id, codigo_proyecto, nombre)
    VALUES (@cliente_id, N'TEST-026', N'Proyecto temporal para prueba de plano cruzado');
    SET @proyecto2_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plano (proyecto_id, codigo_plano, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'620-J-026005', N'Plano 026 proyecto 1', @tipoConexionado_id);

    INSERT INTO nucleo.plano (proyecto_id, codigo_plano, descripcion, tipo_plano_id)
    VALUES (@proyecto2_id, N'620-J-026005', N'Plano 026 proyecto 2', @tipoConexionado_id);

    PRINT 'PASS 5: el mismo codigo_plano fue permitido en un proyecto distinto.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 5: SQL Server rechazo el mismo codigo en un proyecto distinto.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 6
   tipo_plano_id INEXISTENTE -> RECHAZADO (FK)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.plano (proyecto_id, codigo_plano, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'620-J-026006', N'Plano 026 tipo invalido', 999999);

    PRINT 'FAIL 6: SQL Server permitio un tipo_plano_id inexistente.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_MESSAGE() LIKE N'%FK_plano_tipo_plano%'
        PRINT 'PASS 6: SQL Server rechazo el tipo_plano_id inexistente.';
    ELSE
    BEGIN
        PRINT 'FAIL 6: se produjo un error distinto al esperado.';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 7
   descripcion ES OBLIGATORIA (NOT NULL)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.plano (proyecto_id, codigo_plano, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'620-J-026007', NULL, @tipoConexionado_id);

    PRINT 'FAIL 7: SQL Server permitio un plano sin descripcion.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'PASS 7: SQL Server rechazo un plano sin descripcion (NOT NULL).';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 8
   ASOCIACION GABINETE-PLANO VALIDA (MISMO PROYECTO) -> PERMITIDA
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @tipoGabineteRio_id BIGINT;
    SELECT @tipoGabineteRio_id = id FROM cat.cat_tipo_gabinete WHERE codigo = N'RIO';

    DECLARE @gab8_id BIGINT, @plano8_id BIGINT;
    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id)
    VALUES (@proyecto1_id, N'GAB-026-A', @tipoGabineteRio_id);
    SET @gab8_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plano (proyecto_id, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'Plano 026 para asociar a gabinete', @tipoConexionado_id);
    SET @plano8_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.gabinete_plano (proyecto_id, gabinete_id, plano_id)
    VALUES (@proyecto1_id, @gab8_id, @plano8_id);

    PRINT 'PASS 8: asociacion gabinete-plano en el mismo proyecto fue aceptada.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 8: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 9
   ASOCIACION CAJA-PLANO VALIDA (MISMO PROYECTO) -> PERMITIDA
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @caja9_id BIGINT, @plano9_id BIGINT;
    INSERT INTO nucleo.caja (proyecto_id, tag_caja)
    VALUES (@proyecto1_id, N'CAJA-026-A');
    SET @caja9_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plano (proyecto_id, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'Plano 026 para asociar a caja', @tipoConexionado_id);
    SET @plano9_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.caja_plano (proyecto_id, caja_id, plano_id)
    VALUES (@proyecto1_id, @caja9_id, @plano9_id);

    PRINT 'PASS 9: asociacion caja-plano en el mismo proyecto fue aceptada.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 9: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 10
   DUPLICADO ACTIVO DE ASOCIACION GABINETE-PLANO -> RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @tipoGabineteRio10_id BIGINT;
    SELECT @tipoGabineteRio10_id = id FROM cat.cat_tipo_gabinete WHERE codigo = N'RIO';

    DECLARE @gab10_id BIGINT, @plano10_id BIGINT;
    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id)
    VALUES (@proyecto1_id, N'GAB-026-B', @tipoGabineteRio10_id);
    SET @gab10_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plano (proyecto_id, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'Plano 026 para duplicado de asociacion', @tipoConexionado_id);
    SET @plano10_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.gabinete_plano (proyecto_id, gabinete_id, plano_id)
    VALUES (@proyecto1_id, @gab10_id, @plano10_id);

    INSERT INTO nucleo.gabinete_plano (proyecto_id, gabinete_id, plano_id)
    VALUES (@proyecto1_id, @gab10_id, @plano10_id);

    PRINT 'FAIL 10: SQL Server permitio duplicar la misma asociacion gabinete-plano activa.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_MESSAGE() LIKE N'%UX_gabinete_plano_activo%'
        PRINT 'PASS 10: UX_gabinete_plano_activo rechazo la asociacion duplicada.';
    ELSE
    BEGIN
        PRINT 'FAIL 10: se produjo un error distinto al esperado.';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 11
   DUPLICADO ACTIVO DE ASOCIACION CAJA-PLANO -> RECHAZADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @caja11_id BIGINT, @plano11_id BIGINT;
    INSERT INTO nucleo.caja (proyecto_id, tag_caja)
    VALUES (@proyecto1_id, N'CAJA-026-B');
    SET @caja11_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plano (proyecto_id, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'Plano 026 para duplicado de asociacion caja', @tipoConexionado_id);
    SET @plano11_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.caja_plano (proyecto_id, caja_id, plano_id)
    VALUES (@proyecto1_id, @caja11_id, @plano11_id);

    INSERT INTO nucleo.caja_plano (proyecto_id, caja_id, plano_id)
    VALUES (@proyecto1_id, @caja11_id, @plano11_id);

    PRINT 'FAIL 11: SQL Server permitio duplicar la misma asociacion caja-plano activa.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_MESSAGE() LIKE N'%UX_caja_plano_activo%'
        PRINT 'PASS 11: UX_caja_plano_activo rechazo la asociacion duplicada.';
    ELSE
    BEGIN
        PRINT 'FAIL 11: se produjo un error distinto al esperado.';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 12
   ASOCIACION GABINETE-PLANO CROSS-PROJECT -> RECHAZADA
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.proyecto (cliente_id, codigo_proyecto, nombre)
    VALUES (@cliente_id, N'TEST-026B', N'Proyecto temporal 2 para prueba cruzada');
    DECLARE @proyecto3_id BIGINT = SCOPE_IDENTITY();

    DECLARE @tipoGabineteRio12_id BIGINT;
    SELECT @tipoGabineteRio12_id = id FROM cat.cat_tipo_gabinete WHERE codigo = N'RIO';

    DECLARE @gab12_id BIGINT, @plano12_id BIGINT;
    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id)
    VALUES (@proyecto3_id, N'GAB-026-CRUZADO', @tipoGabineteRio12_id);
    SET @gab12_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plano (proyecto_id, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'Plano 026 en proyecto 1, intento cruzado', @tipoConexionado_id);
    SET @plano12_id = SCOPE_IDENTITY();

    -- El gabinete es del proyecto3, el plano del proyecto1, pero la fila
    -- de union declara proyecto_id = proyecto1 -> la FK compuesta
    -- (gabinete_id, proyecto_id) nunca encuentra esa combinacion.
    INSERT INTO nucleo.gabinete_plano (proyecto_id, gabinete_id, plano_id)
    VALUES (@proyecto1_id, @gab12_id, @plano12_id);

    PRINT 'FAIL 12: SQL Server permitio una asociacion gabinete-plano cruzando de proyecto.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_MESSAGE() LIKE N'%FK_gabinete_plano_gabinete%'
        PRINT 'PASS 12: SQL Server rechazo la asociacion gabinete-plano cruzando de proyecto.';
    ELSE
    BEGIN
        PRINT 'FAIL 12: se produjo un error distinto al esperado.';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 13
   ASOCIACION CAJA-PLANO CROSS-PROJECT -> RECHAZADA
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.proyecto (cliente_id, codigo_proyecto, nombre)
    VALUES (@cliente_id, N'TEST-026C', N'Proyecto temporal 3 para prueba cruzada de caja');
    DECLARE @proyecto4_id BIGINT = SCOPE_IDENTITY();

    DECLARE @caja13_id BIGINT, @plano13_id BIGINT;
    INSERT INTO nucleo.caja (proyecto_id, tag_caja)
    VALUES (@proyecto4_id, N'CAJA-026-CRUZADA');
    SET @caja13_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plano (proyecto_id, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'Plano 026 en proyecto 1, intento cruzado caja', @tipoConexionado_id);
    SET @plano13_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.caja_plano (proyecto_id, caja_id, plano_id)
    VALUES (@proyecto1_id, @caja13_id, @plano13_id);

    PRINT 'FAIL 13: SQL Server permitio una asociacion caja-plano cruzando de proyecto.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    IF ERROR_MESSAGE() LIKE N'%FK_caja_plano_caja%'
        PRINT 'PASS 13: SQL Server rechazo la asociacion caja-plano cruzando de proyecto.';
    ELSE
    BEGIN
        PRINT 'FAIL 13: se produjo un error distinto al esperado.';
        PRINT ERROR_MESSAGE();
    END
END CATCH;


/* ============================================================
   CASO 14
   VARIOS PLANOS PARA UN GABINETE, Y VARIOS GABINETES PARA UN
   PLANO -> AMBOS PERMITIDOS (evidencia real: 620-RIO-5012 con 7
   planos propios; fila 34 de PLANOS con un plano para 2 cajas —
   aqui se reproduce el mismo patron N:M del lado gabinete)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @tipoGabineteRio14_id BIGINT;
    SELECT @tipoGabineteRio14_id = id FROM cat.cat_tipo_gabinete WHERE codigo = N'RIO';

    DECLARE @gab14a_id BIGINT, @gab14b_id BIGINT, @plano14a_id BIGINT, @plano14b_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id)
    VALUES (@proyecto1_id, N'GAB-026-C1', @tipoGabineteRio14_id);
    SET @gab14a_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id)
    VALUES (@proyecto1_id, N'GAB-026-C2', @tipoGabineteRio14_id);
    SET @gab14b_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plano (proyecto_id, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'Plano 026 N:M A', @tipoConexionado_id);
    SET @plano14a_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plano (proyecto_id, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'Plano 026 N:M B', @tipoLayout_id);
    SET @plano14b_id = SCOPE_IDENTITY();

    -- Un gabinete (gab14a) con DOS planos distintos (14a, 14b)
    INSERT INTO nucleo.gabinete_plano (proyecto_id, gabinete_id, plano_id) VALUES (@proyecto1_id, @gab14a_id, @plano14a_id);
    INSERT INTO nucleo.gabinete_plano (proyecto_id, gabinete_id, plano_id) VALUES (@proyecto1_id, @gab14a_id, @plano14b_id);

    -- Un plano (plano14a) con DOS gabinetes distintos (14a, 14b)
    INSERT INTO nucleo.gabinete_plano (proyecto_id, gabinete_id, plano_id) VALUES (@proyecto1_id, @gab14b_id, @plano14a_id);

    IF (SELECT COUNT(*) FROM nucleo.gabinete_plano WHERE gabinete_id = @gab14a_id AND activo = 1) = 2
       AND (SELECT COUNT(*) FROM nucleo.gabinete_plano WHERE plano_id = @plano14a_id AND activo = 1) = 2
        PRINT 'PASS 14: varios planos para un gabinete y varios gabinetes para un plano fueron permitidos (N:M real).';
    ELSE
        PRINT 'FAIL 14: la cardinalidad N:M gabinete-plano no quedo como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 14: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 15
   VARIOS PLANOS PARA UNA CAJA, Y VARIAS CAJAS PARA UN PLANO ->
   AMBOS PERMITIDOS (evidencia real: fila 34 de PLANOS,
   TABLERO='620-TBC-5016/5017', un plano LAYOUT para dos cajas;
   620-TBC-5016 con 3 planos propios)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @caja15a_id BIGINT, @caja15b_id BIGINT, @plano15a_id BIGINT, @plano15b_id BIGINT;

    INSERT INTO nucleo.caja (proyecto_id, tag_caja) VALUES (@proyecto1_id, N'CAJA-026-C1');
    SET @caja15a_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.caja (proyecto_id, tag_caja) VALUES (@proyecto1_id, N'CAJA-026-C2');
    SET @caja15b_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plano (proyecto_id, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'Plano 026 N:M caja A', @tipoConexionado_id);
    SET @plano15a_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plano (proyecto_id, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'Plano 026 N:M caja B', @tipoLayout_id);
    SET @plano15b_id = SCOPE_IDENTITY();

    -- Una caja (caja15a) con DOS planos distintos
    INSERT INTO nucleo.caja_plano (proyecto_id, caja_id, plano_id) VALUES (@proyecto1_id, @caja15a_id, @plano15a_id);
    INSERT INTO nucleo.caja_plano (proyecto_id, caja_id, plano_id) VALUES (@proyecto1_id, @caja15a_id, @plano15b_id);

    -- Un plano (plano15a) con DOS cajas distintas — reproduce la fila 34 del Excel
    INSERT INTO nucleo.caja_plano (proyecto_id, caja_id, plano_id) VALUES (@proyecto1_id, @caja15b_id, @plano15a_id);

    IF (SELECT COUNT(*) FROM nucleo.caja_plano WHERE caja_id = @caja15a_id AND activo = 1) = 2
       AND (SELECT COUNT(*) FROM nucleo.caja_plano WHERE plano_id = @plano15a_id AND activo = 1) = 2
        PRINT 'PASS 15: varios planos para una caja y varias cajas para un plano fueron permitidos (N:M real).';
    ELSE
        PRINT 'FAIL 15: la cardinalidad N:M caja-plano no quedo como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 15: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 16
   SOFT DELETE DE PLANO (activo=0) -> PERMITIDO, SIGUE EXISTIENDO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @plano16_id BIGINT;
    INSERT INTO nucleo.plano (proyecto_id, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'Plano 026 para soft delete', @tipoConexionado_id);
    SET @plano16_id = SCOPE_IDENTITY();

    UPDATE nucleo.plano SET activo = 0 WHERE id = @plano16_id;

    IF EXISTS (SELECT 1 FROM nucleo.plano WHERE id = @plano16_id AND activo = 0)
        PRINT 'PASS 16: el plano quedo desactivado (activo=0) sin eliminarse.';
    ELSE
        PRINT 'FAIL 16: el plano no quedo desactivado como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 16: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 17
   SOFT DELETE Y REACTIVACION DE UNA ASOCIACION (desactivar,
   luego volver a activar la MISMA fila) -> PERMITIDO SIN
   DUPLICAR, RESPETANDO EL INDICE UNICO FILTRADO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @tipoGabineteRio17_id BIGINT;
    SELECT @tipoGabineteRio17_id = id FROM cat.cat_tipo_gabinete WHERE codigo = N'RIO';

    DECLARE @gab17_id BIGINT, @plano17_id BIGINT, @asociacion17_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id)
    VALUES (@proyecto1_id, N'GAB-026-D', @tipoGabineteRio17_id);
    SET @gab17_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plano (proyecto_id, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'Plano 026 para reactivar asociacion', @tipoConexionado_id);
    SET @plano17_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.gabinete_plano (proyecto_id, gabinete_id, plano_id)
    VALUES (@proyecto1_id, @gab17_id, @plano17_id);
    SET @asociacion17_id = SCOPE_IDENTITY();

    UPDATE nucleo.gabinete_plano SET activo = 0 WHERE id = @asociacion17_id;

    -- Reactivar la MISMA fila (UPDATE, no INSERT) — asi es como lo hace
    -- el backend (ver associateEntidad en planos.ts).
    UPDATE nucleo.gabinete_plano SET activo = 1 WHERE id = @asociacion17_id;

    IF (SELECT COUNT(*) FROM nucleo.gabinete_plano WHERE gabinete_id = @gab17_id AND plano_id = @plano17_id) = 1
       AND EXISTS (SELECT 1 FROM nucleo.gabinete_plano WHERE id = @asociacion17_id AND activo = 1)
        PRINT 'PASS 17: la asociacion se desactivo y reactivo sin duplicar la fila.';
    ELSE
        PRINT 'FAIL 17: la reactivacion de la asociacion no quedo como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 17: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 18
   AUDITORIA: created_by/updated_by SE PUEBLAN CUANDO SE INDICAN,
   QUEDAN NULL SI NO (patron estandar del esquema)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    -- No se asume que seguridad.usuario ya tenga filas (una instalacion
    -- limpia recien migrada, sin database/dev/001_dev_auth_seed.sql
    -- aplicado, no tiene ninguna) — se crea un usuario propio del test si
    -- hace falta, dentro de la misma transaccion que se revierte al final.
    DECLARE @usuario_id BIGINT;
    SELECT TOP (1) @usuario_id = id FROM seguridad.usuario;

    IF @usuario_id IS NULL
    BEGIN
        INSERT INTO seguridad.usuario (email, nombre)
        VALUES (N'test026@siei.local', N'Usuario de prueba 026');
        SET @usuario_id = SCOPE_IDENTITY();
    END

    DECLARE @plano18a_id BIGINT, @plano18b_id BIGINT;

    INSERT INTO nucleo.plano (proyecto_id, descripcion, tipo_plano_id, created_by)
    VALUES (@proyecto1_id, N'Plano 026 con auditoria', @tipoConexionado_id, @usuario_id);
    SET @plano18a_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.plano (proyecto_id, descripcion, tipo_plano_id)
    VALUES (@proyecto1_id, N'Plano 026 sin auditoria', @tipoConexionado_id);
    SET @plano18b_id = SCOPE_IDENTITY();

    IF EXISTS (SELECT 1 FROM nucleo.plano WHERE id = @plano18a_id AND created_by = @usuario_id)
       AND EXISTS (SELECT 1 FROM nucleo.plano WHERE id = @plano18b_id AND created_by IS NULL)
        PRINT 'PASS 18: created_by se puebla cuando se indica y queda NULL cuando no.';
    ELSE
        PRINT 'FAIL 18: la auditoria de created_by no quedo como se esperaba.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    PRINT 'FAIL 18: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 026';
PRINT '=========================================';
