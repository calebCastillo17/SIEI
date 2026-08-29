SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

/*
 * TEST 024 - GABINETE (migracion 012: nucleo.rio -> nucleo.gabinete)
 *
 * Cubre lo que las pruebas de API (physical-hierarchy, physical-connections,
 * comm-links) no pueden verificar porque viven bajo la capa HTTP: la
 * propiedad de preservacion de datos del mecanismo usado por la migracion
 * (sp_rename) y las restricciones a nivel de motor (NOT NULL, FK, indice
 * unico filtrado, XOR de pertenencia). La creacion RIO/CONTROL/COMUNICACION,
 * "tipo obligatorio", "tag unico por proyecto", rack/punto_conexion/switch
 * -> gabinete y el nodo intermedio invalido en una ruta ya estan probados
 * end-to-end en las suites de API y en el test 007; no se duplican aqui
 * salvo donde agregan una verificacion distinta (nivel SQL crudo en vez de
 * nivel API).
 *
 * NOTA SOBRE "BEFORE/AFTER" DE LA MIGRACION 012:
 * este archivo se ejecuta DESPUES de aplicar 012 (incluso en una
 * instalacion recien creada, 012 ya corrio antes de llegar a este test),
 * por lo que ningun script que corra aqui puede observar honestamente el
 * estado de nucleo.rio previo al rename -- ese estado ya no existe una vez
 * migrado. La comprobacion before/after REAL contra datos preexistentes
 * (fila id=1, tag_gabinete='RIO-TEST-001', mismo created_at que tenia como
 * nucleo.rio) solo pudo hacerse UNA vez, de forma manual, en el momento en
 * que 012 se aplico sobre SIEI_DEV (snapshot tomado antes, migracion
 * aplicada, snapshot comparado despues) -- ese resultado puntual quedo
 * documentado en el reporte de entrega de 012, no es repetible aqui sin
 * inventar un "antes" que ya no existe. Lo que SI es reproducible en
 * cualquier base de datos (SIEI_DEV o una instalacion 001->012 recien
 * hecha) es la propiedad general en la que se apoyo esa migracion: que
 * sp_rename (tabla + columna), el mecanismo real que usa 012, no reinserta
 * filas ni altera sus valores. El CASO 1 de abajo demuestra exactamente
 * esa propiedad, con su propio "antes" y "despues" capturados en el
 * momento -- sin hardcodear ningun timestamp ni valor propio de una base
 * en particular. El CASO 2 es un smoke post-migracion aparte, honesto
 * sobre lo que es: confirma que la fila fixture real quedo con una forma
 * estructural coherente hoy, no que se "preservo" (eso ya lo prueba el
 * CASO 1 a nivel de mecanismo).
 */

DECLARE @cliente_id BIGINT;
DECLARE @proyecto1_id BIGINT;
DECLARE @proyecto2_id BIGINT;
DECLARE @tipoRio_id BIGINT;
DECLARE @tipoControl_id BIGINT;
DECLARE @tipoComunicacion_id BIGINT;

SELECT @proyecto1_id = id,
       @cliente_id = cliente_id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

IF @proyecto1_id IS NULL
    THROW 52401, 'No existe TEST-001.', 1;

SELECT @tipoRio_id = id FROM cat.cat_tipo_gabinete WHERE codigo = N'RIO';
SELECT @tipoControl_id = id FROM cat.cat_tipo_gabinete WHERE codigo = N'CONTROL';
SELECT @tipoComunicacion_id = id FROM cat.cat_tipo_gabinete WHERE codigo = N'COMUNICACION';

PRINT '=========================================';
PRINT 'TEST 024 - GABINETE (migracion 012)';
PRINT '=========================================';


/* ============================================================
   CASO 1
   PROPIEDAD DE PRESERVACION DE sp_rename (el mecanismo real que usa 012)

   Se reproduce, a pequeña escala y sobre una tabla descartable propia de
   este test, el mismo tipo de operacion que ejecuto 012 sobre nucleo.rio:
   CREATE TABLE -> INSERT -> sp_rename de TABLA -> sp_rename de COLUMNA ->
   releer la misma fila por su id. El "antes" y el "despues" se capturan
   en variables en tiempo de ejecucion (nada hardcodeado: ni timestamp ni
   ningun otro valor de una base en particular), y todo corre dentro de
   una transaccion que termina en ROLLBACK -- no deja ningun objeto
   residual, funciona igual en SIEI_DEV que en una instalacion 001->012
   recien creada.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    CREATE TABLE nucleo.zzz_test_024_rename_probe (
        id              BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        proyecto_id     BIGINT NOT NULL,
        tag_probe       NVARCHAR(50) NOT NULL,
        descripcion     NVARCHAR(200) NULL,
        activo          BIT NOT NULL DEFAULT 1,
        created_at      DATETIME2(7) NOT NULL DEFAULT SYSUTCDATETIME(),
        created_by      BIGINT NULL
    );

    INSERT INTO nucleo.zzz_test_024_rename_probe (proyecto_id, tag_probe, descripcion)
    VALUES (@proyecto1_id, N'PROBE-024', N'Fila de prueba antes del rename');

    DECLARE @probe_id BIGINT = SCOPE_IDENTITY();

    -- "Antes": capturado ahora mismo, no un valor fijo de ninguna base
    DECLARE @antes_proyecto BIGINT, @antes_tag NVARCHAR(50), @antes_desc NVARCHAR(200),
            @antes_activo BIT, @antes_created DATETIME2(7), @antes_by BIGINT;

    SELECT @antes_proyecto = proyecto_id, @antes_tag = tag_probe, @antes_desc = descripcion,
           @antes_activo = activo, @antes_created = created_at, @antes_by = created_by
    FROM nucleo.zzz_test_024_rename_probe
    WHERE id = @probe_id;

    -- La MISMA clase de operacion que aplico 012: rename de tabla y de columna via sp_rename
    EXEC sp_rename N'nucleo.zzz_test_024_rename_probe', N'zzz_test_024_rename_probe_gab';
    EXEC sp_rename N'nucleo.zzz_test_024_rename_probe_gab.tag_probe', N'tag_probe_renombrado', N'COLUMN';

    -- "Despues": misma fila, mismo id, releida desde el objeto ya renombrado
    DECLARE @despues_proyecto BIGINT, @despues_tag NVARCHAR(50), @despues_desc NVARCHAR(200),
            @despues_activo BIT, @despues_created DATETIME2(7), @despues_by BIGINT;

    SELECT @despues_proyecto = proyecto_id, @despues_tag = tag_probe_renombrado, @despues_desc = descripcion,
           @despues_activo = activo, @despues_created = created_at, @despues_by = created_by
    FROM nucleo.zzz_test_024_rename_probe_gab
    WHERE id = @probe_id;

    IF @antes_proyecto = @despues_proyecto
       AND @antes_tag = @despues_tag
       AND @antes_desc = @despues_desc
       AND @antes_activo = @despues_activo
       AND @antes_created = @despues_created
       AND @antes_by IS NULL AND @despues_by IS NULL
        PRINT 'PASS 1: sp_rename (tabla + columna) preservo id/proyecto_id/tag/descripcion/activo/created_at/created_by sin reinsertar la fila -- el mismo mecanismo que aplico la migracion 012 sobre nucleo.rio.';
    ELSE
        PRINT 'FAIL 1: algun valor cambio tras el sp_rename; la propiedad de preservacion no se cumple.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 1: se produjo un error inesperado al probar la preservacion de sp_rename.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 2
   SMOKE POST-MIGRACION (no es una prueba de preservacion, ver nota al
   inicio del archivo): la fila fixture real (creada por
   database/tests/001_smoke_modulo.sql, con los mismos valores literales
   en cualquier base donde se haya corrido ese setup) tiene, HOY, una
   forma estructuralmente coherente: tag/descripcion/activo/tipo esperados,
   y sus columnas de auditoria pobladas. created_at solo se exige NOT NULL
   -- su valor exacto es el momento real en que esa base insertó la fila,
   distinto en SIEI_DEV y en una instalacion recien creada, y por eso no
   se compara contra ningun valor fijo.
   ============================================================ */

IF EXISTS (
    SELECT 1
    FROM nucleo.gabinete
    WHERE id = 1
      AND tag_gabinete = N'RIO-TEST-001'
      AND descripcion = N'RIO de prueba'
      AND activo = 1
      AND tag_anterior IS NULL
      AND tipo_gabinete_id = @tipoRio_id
      AND created_at IS NOT NULL
)
    PRINT 'PASS 2: la fila fixture (id=1) tiene la forma post-migracion esperada (tag/descripcion/activo/tipo/auditoria).';
ELSE
    PRINT 'FAIL 2: la fila fixture no tiene la forma post-migracion esperada.';


/* ============================================================
   CASO 3
   cat.cat_tipo_gabinete TRAE EXACTAMENTE RIO / CONTROL / COMUNICACION
   ============================================================ */

IF (SELECT COUNT(*) FROM cat.cat_tipo_gabinete WHERE codigo IN (N'RIO', N'CONTROL', N'COMUNICACION')) = 3
   AND (SELECT COUNT(*) FROM cat.cat_tipo_gabinete) = 3
    PRINT 'PASS 3: cat.cat_tipo_gabinete tiene exactamente RIO, CONTROL y COMUNICACION.';
ELSE
    PRINT 'FAIL 3: cat.cat_tipo_gabinete no tiene exactamente esos 3 codigos.';


/* ============================================================
   CASO 4
   tipo_gabinete_id ES OBLIGATORIO (NOT NULL) A NIVEL DE MOTOR
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, descripcion)
    VALUES (@proyecto1_id, N'GAB-024-SINTIPO', N'Sin tipo, debe fallar');

    PRINT 'FAIL 4: SQL Server permitio un gabinete sin tipo_gabinete_id.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'PASS 4: SQL Server rechazo el gabinete sin tipo_gabinete_id (NOT NULL).';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 5
   UN tipo_gabinete_id INEXISTENTE SE RECHAZA
   (FK_gabinete_tipo_gabinete)
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id)
    VALUES (@proyecto1_id, N'GAB-024-TIPOMALO', 999999);

    PRINT 'FAIL 5: SQL Server permitio un tipo_gabinete_id inexistente.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error5 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error5 LIKE N'%FK_gabinete_tipo_gabinete%'
        PRINT 'PASS 5: SQL Server rechazo el tipo_gabinete_id inexistente.';
    ELSE
    BEGIN
        PRINT 'FAIL 5: se produjo un error distinto al esperado.';
        PRINT @error5;
    END
END CATCH;


/* ============================================================
   CASO 6
   tag_anterior ES NULLABLE, SIN UNIQUE: DOS GABINETES PUEDEN
   COMPARTIR EL MISMO tag_anterior SIN CONFLICTO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id, tag_anterior)
    VALUES (@proyecto1_id, N'GAB-024-WSP-A', @tipoControl_id, N'WSP-COMPARTIDO-024');

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id, tag_anterior)
    VALUES (@proyecto1_id, N'GAB-024-WSP-B', @tipoControl_id, N'WSP-COMPARTIDO-024');

    IF (SELECT COUNT(*) FROM nucleo.gabinete WHERE tag_anterior = N'WSP-COMPARTIDO-024') = 2
        PRINT 'PASS 6: tag_anterior es nullable y no exige unicidad entre gabinetes.';
    ELSE
        PRINT 'FAIL 6: no quedaron ambos gabinetes con el mismo tag_anterior.';

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL 6: se produjo un error inesperado.';
    PRINT ERROR_MESSAGE();
END CATCH;


/* ============================================================
   CASO 7
   CK_punto_conexion_pertenencia_xor SIGUE RECHAZANDO DOS DUEÑOS
   A LA VEZ CUANDO UNO DE ELLOS ES gabinete_id
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @gab7_id BIGINT;
    DECLARE @inst7_id BIGINT;

    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id)
    VALUES (@proyecto1_id, N'GAB-024-XOR', @tipoRio_id);
    SET @gab7_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.instrumento (proyecto_id, tag_instrumento, descripcion)
    VALUES (@proyecto1_id, N'PIT-024-XOR', N'Prueba XOR con gabinete');
    SET @inst7_id = SCOPE_IDENTITY();

    INSERT INTO nucleo.punto_conexion (proyecto_id, instrumento_id, gabinete_id, descripcion)
    VALUES (@proyecto1_id, @inst7_id, @gab7_id, N'Dos dueños a la vez');

    PRINT 'FAIL 7: SQL Server permitio instrumento_id y gabinete_id juntos.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @error7 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error7 LIKE N'%CK_punto_conexion_pertenencia_xor%'
        PRINT 'PASS 7: CK_punto_conexion_pertenencia_xor rechazo instrumento_id + gabinete_id juntos.';
    ELSE
    BEGIN
        PRINT 'FAIL 7: se produjo un error distinto al esperado.';
        PRINT @error7;
    END
END CATCH;


/* ============================================================
   CASO 8
   PROTECCION MULTIPROYECTO: rack.gabinete_id, punto_conexion.gabinete_id
   Y switch.gabinete_id NO PUEDEN APUNTAR A UN GABINETE DE OTRO PROYECTO
   (FK compuesta (gabinete_id, proyecto_id))
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    INSERT INTO nucleo.proyecto (cliente_id, codigo_proyecto, nombre)
    VALUES (@cliente_id, N'TEST-024', N'Proyecto temporal para prueba de gabinete cruzado');
    SET @proyecto2_id = SCOPE_IDENTITY();

    DECLARE @gab8_p2_id BIGINT;
    INSERT INTO nucleo.gabinete (proyecto_id, tag_gabinete, tipo_gabinete_id)
    VALUES (@proyecto2_id, N'GAB-024-P2', @tipoComunicacion_id);
    SET @gab8_p2_id = SCOPE_IDENTITY();

    -- 8a. rack del proyecto 1 apuntando a un gabinete del proyecto 2
    BEGIN TRY
        INSERT INTO nucleo.rack (proyecto_id, gabinete_id, numero_rack)
        VALUES (@proyecto1_id, @gab8_p2_id, 1);

        PRINT 'FAIL 8a: SQL Server permitio un rack cruzando de proyecto via gabinete_id.';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 8a: SQL Server rechazo el rack con gabinete_id de otro proyecto.';
    END CATCH;

    -- 8b. punto_conexion del proyecto 1 apuntando a un gabinete del proyecto 2
    BEGIN TRY
        INSERT INTO nucleo.punto_conexion (proyecto_id, gabinete_id, descripcion)
        VALUES (@proyecto1_id, @gab8_p2_id, N'Cruce de proyecto intencional');

        PRINT 'FAIL 8b: SQL Server permitio un punto_conexion cruzando de proyecto via gabinete_id.';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 8b: SQL Server rechazo el punto_conexion con gabinete_id de otro proyecto.';
    END CATCH;

    -- 8c. switch del proyecto 1 apuntando a un gabinete del proyecto 2
    BEGIN TRY
        INSERT INTO nucleo.switch (proyecto_id, tag_switch, gabinete_id)
        VALUES (@proyecto1_id, N'SW-024-CRUZADO', @gab8_p2_id);

        PRINT 'FAIL 8c: SQL Server permitio un switch cruzando de proyecto via gabinete_id.';
    END TRY
    BEGIN CATCH
        PRINT 'PASS 8c: SQL Server rechazo el switch con gabinete_id de otro proyecto.';
    END CATCH;

    ROLLBACK TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL GENERAL CASO 8.';
    PRINT ERROR_MESSAGE();
END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 024';
PRINT '=========================================';
