SET NOCOUNT ON;

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @proyecto_id BIGINT;
DECLARE @cliente_id BIGINT;

DECLARE @rol_admin BIGINT;
DECLARE @rol_editor BIGINT;
DECLARE @rol_viewer BIGINT;

SELECT
    @proyecto_id = id,
    @cliente_id = cliente_id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

SELECT @rol_admin = id
FROM seguridad.rol
WHERE codigo = N'ADMIN';

SELECT @rol_editor = id
FROM seguridad.rol
WHERE codigo = N'EDITOR';

SELECT @rol_viewer = id
FROM seguridad.rol
WHERE codigo = N'VIEWER';

IF @proyecto_id IS NULL
    THROW 53001, 'No existe TEST-001.', 1;

IF @rol_admin IS NULL
   OR @rol_editor IS NULL
   OR @rol_viewer IS NULL
    THROW 53002, 'No existen los tres roles de seguridad.', 1;


PRINT '=========================================';
PRINT 'TEST 016 - SEGURIDAD Y ROLES';
PRINT '=========================================';


/* ============================================================
   CASO 1
   ADMIN DEL SISTEMA

   Sin asignaciones explícitas debe ver TODOS los proyectos
   activos como ADMIN.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @usuario_admin BIGINT;
    DECLARE @total_proyectos INT;
    DECLARE @total_admin INT;

    INSERT INTO seguridad.usuario
    (
        email,
        nombre,
        es_admin_sistema
    )
    VALUES
    (
        N'test016.admin@siei.local',
        N'Admin TEST 016',
        1
    );

    SET @usuario_admin = SCOPE_IDENTITY();


    SELECT @total_proyectos = COUNT(*)
    FROM nucleo.proyecto
    WHERE activo = 1;


    SELECT @total_admin = COUNT(*)
    FROM seguridad.vw_acceso_proyecto
    WHERE usuario_id = @usuario_admin;


    IF @total_admin <> @total_proyectos
        THROW 53101,
        'FAIL: ADMIN sistema no obtuvo acceso a todos los proyectos activos.',
        1;


    IF EXISTS
    (
        SELECT 1
        FROM seguridad.vw_acceso_proyecto
        WHERE usuario_id = @usuario_admin
          AND
          (
              rol_codigo <> N'ADMIN'
              OR puede_escribir <> 1
              OR puede_desactivar <> 1
              OR puede_administrar <> 1
          )
    )
        THROW 53102,
        'FAIL: ADMIN sistema no obtuvo permisos completos.',
        1;


    PRINT 'PASS 1: ADMIN sistema accede a todos los proyectos activos con permisos completos.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL CASO 1.';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASOS 2, 3 Y 4

   EDITOR asignado -> acceso de escritura.
   VIEWER asignado -> solo lectura.
   USUARIO sin asignación -> no tiene acceso.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @usuario_editor BIGINT;
    DECLARE @usuario_viewer BIGINT;
    DECLARE @usuario_sin_acceso BIGINT;


    INSERT INTO seguridad.usuario
        (email, nombre)
    VALUES
        (N'test016.editor@siei.local', N'Editor TEST 016');

    SET @usuario_editor = SCOPE_IDENTITY();


    INSERT INTO seguridad.usuario
        (email, nombre)
    VALUES
        (N'test016.viewer@siei.local', N'Viewer TEST 016');

    SET @usuario_viewer = SCOPE_IDENTITY();


    INSERT INTO seguridad.usuario
        (email, nombre)
    VALUES
        (N'test016.none@siei.local', N'Sin acceso TEST 016');

    SET @usuario_sin_acceso = SCOPE_IDENTITY();


    INSERT INTO seguridad.usuario_proyecto_rol
    (
        usuario_id,
        proyecto_id,
        rol_id
    )
    VALUES
    (
        @usuario_editor,
        @proyecto_id,
        @rol_editor
    );


    INSERT INTO seguridad.usuario_proyecto_rol
    (
        usuario_id,
        proyecto_id,
        rol_id
    )
    VALUES
    (
        @usuario_viewer,
        @proyecto_id,
        @rol_viewer
    );


    IF NOT EXISTS
    (
        SELECT 1
        FROM seguridad.vw_acceso_proyecto
        WHERE usuario_id = @usuario_editor
          AND proyecto_id = @proyecto_id
          AND rol_codigo = N'EDITOR'
          AND puede_escribir = 1
          AND puede_desactivar = 0
          AND puede_administrar = 0
    )
        THROW 53110,
        'FAIL: permisos EDITOR incorrectos.',
        1;


    PRINT 'PASS 2: EDITOR obtiene acceso de escritura al proyecto asignado.';


    IF NOT EXISTS
    (
        SELECT 1
        FROM seguridad.vw_acceso_proyecto
        WHERE usuario_id = @usuario_viewer
          AND proyecto_id = @proyecto_id
          AND rol_codigo = N'VIEWER'
          AND puede_escribir = 0
          AND puede_desactivar = 0
          AND puede_administrar = 0
    )
        THROW 53111,
        'FAIL: permisos VIEWER incorrectos.',
        1;


    PRINT 'PASS 3: VIEWER obtiene acceso de solo lectura al proyecto asignado.';


    IF EXISTS
    (
        SELECT 1
        FROM seguridad.vw_acceso_proyecto
        WHERE usuario_id = @usuario_sin_acceso
    )
        THROW 53112,
        'FAIL: usuario sin asignacion obtuvo acceso a un proyecto.',
        1;


    PRINT 'PASS 4: usuario sin asignacion no obtiene acceso a proyectos.';


    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL CASOS 2-4.';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 5
   DOS ROLES ACTIVOS PARA EL MISMO USUARIO / PROYECTO

   DEBE SER RECHAZADO.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @usuario_dup BIGINT;

    INSERT INTO seguridad.usuario
        (email, nombre)
    VALUES
        (N'test016.duplicate@siei.local', N'Duplicado TEST 016');

    SET @usuario_dup = SCOPE_IDENTITY();


    INSERT INTO seguridad.usuario_proyecto_rol
        (usuario_id, proyecto_id, rol_id)
    VALUES
        (@usuario_dup, @proyecto_id, @rol_editor);


    -- ERROR INTENCIONAL
    INSERT INTO seguridad.usuario_proyecto_rol
        (usuario_id, proyecto_id, rol_id)
    VALUES
        (@usuario_dup, @proyecto_id, @rol_viewer);


    PRINT 'FAIL 5: SQL Server permitio dos roles activos para el mismo usuario/proyecto.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    DECLARE @error5 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error5 LIKE N'%UX_seg_upr_usuario_proyecto_activo%'
    BEGIN
        PRINT 'PASS 5: SQL Server rechazo dos roles activos para el mismo usuario/proyecto.';
        PRINT 'Error esperado:';
        PRINT @error5;
    END
    ELSE
    BEGIN
        PRINT 'FAIL 5: se produjo un error distinto al esperado.';
        PRINT @error5;
    END

END CATCH;


/* ============================================================
   CASO 6
   USUARIO INACTIVO NO PUEDE RECIBIR ACCESO
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @usuario_inactivo BIGINT;

    INSERT INTO seguridad.usuario
    (
        email,
        nombre,
        activo
    )
    VALUES
    (
        N'test016.inactive@siei.local',
        N'Inactivo TEST 016',
        0
    );

    SET @usuario_inactivo = SCOPE_IDENTITY();


    -- ERROR INTENCIONAL
    INSERT INTO seguridad.usuario_proyecto_rol
        (usuario_id, proyecto_id, rol_id)
    VALUES
        (@usuario_inactivo, @proyecto_id, @rol_viewer);


    PRINT 'FAIL 6: SQL Server permitio asignar acceso a usuario inactivo.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    DECLARE @error6 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error6 LIKE N'%USUARIO inactivo%'
    BEGIN
        PRINT 'PASS 6: SQL Server rechazo asignar acceso a un usuario inactivo.';
        PRINT 'Error esperado:';
        PRINT @error6;
    END
    ELSE
    BEGIN
        PRINT 'FAIL 6: se produjo un error distinto al esperado.';
        PRINT @error6;
    END

END CATCH;


/* ============================================================
   CASO 7
   PROYECTO INACTIVO NO PUEDE RECIBIR ASIGNACIONES
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @proyecto_inactivo BIGINT;
    DECLARE @usuario_p_inactivo BIGINT;

    INSERT INTO nucleo.proyecto
    (
        cliente_id,
        codigo_proyecto,
        nombre,
        activo
    )
    VALUES
    (
        @cliente_id,
        N'TEST-AUTH-016A',
        N'Proyecto inactivo TEST 016',
        0
    );

    SET @proyecto_inactivo = SCOPE_IDENTITY();


    INSERT INTO seguridad.usuario
        (email, nombre)
    VALUES
        (N'test016.projectinactive@siei.local',
         N'Usuario Proyecto Inactivo');

    SET @usuario_p_inactivo = SCOPE_IDENTITY();


    -- ERROR INTENCIONAL
    INSERT INTO seguridad.usuario_proyecto_rol
        (usuario_id, proyecto_id, rol_id)
    VALUES
        (@usuario_p_inactivo, @proyecto_inactivo, @rol_editor);


    PRINT 'FAIL 7: SQL Server permitio asignar acceso a proyecto inactivo.';

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    DECLARE @error7 NVARCHAR(4000) = ERROR_MESSAGE();

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    IF @error7 LIKE N'%PROYECTO inactivo%'
    BEGIN
        PRINT 'PASS 7: SQL Server rechazo asignar acceso a un proyecto inactivo.';
        PRINT 'Error esperado:';
        PRINT @error7;
    END
    ELSE
    BEGIN
        PRINT 'FAIL 7: se produjo un error distinto al esperado.';
        PRINT @error7;
    END

END CATCH;


/* ============================================================
   CASO 8
   DESACTIVAR USUARIO

   SUS ASIGNACIONES ACTIVAS DEBEN DESACTIVARSE.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @usuario_baja BIGINT;
    DECLARE @upr_baja BIGINT;

    INSERT INTO seguridad.usuario
        (email, nombre)
    VALUES
        (N'test016.userdisable@siei.local',
         N'Usuario a desactivar');

    SET @usuario_baja = SCOPE_IDENTITY();


    INSERT INTO seguridad.usuario_proyecto_rol
    (
        usuario_id,
        proyecto_id,
        rol_id
    )
    VALUES
    (
        @usuario_baja,
        @proyecto_id,
        @rol_editor
    );

    SET @upr_baja = SCOPE_IDENTITY();


    UPDATE seguridad.usuario
    SET activo = 0,
        updated_at = SYSUTCDATETIME()
    WHERE id = @usuario_baja;


    IF EXISTS
    (
        SELECT 1
        FROM seguridad.usuario_proyecto_rol
        WHERE id = @upr_baja
          AND activo = 1
    )
        THROW 53180,
        'FAIL: acceso siguio activo al desactivar usuario.',
        1;


    IF EXISTS
    (
        SELECT 1
        FROM seguridad.vw_acceso_proyecto
        WHERE usuario_id = @usuario_baja
    )
        THROW 53181,
        'FAIL: usuario inactivo sigue apareciendo en acceso efectivo.',
        1;


    PRINT 'PASS 8: desactivar usuario desactivo automaticamente sus accesos.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL CASO 8.';
    PRINT ERROR_MESSAGE();

END CATCH;


/* ============================================================
   CASO 9
   DESACTIVAR PROYECTO

   SUS ASIGNACIONES ACTIVAS DEBEN DESACTIVARSE.
   ============================================================ */

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @proyecto_baja BIGINT;
    DECLARE @usuario_pbaja BIGINT;
    DECLARE @upr_pbaja BIGINT;

    INSERT INTO nucleo.proyecto
    (
        cliente_id,
        codigo_proyecto,
        nombre
    )
    VALUES
    (
        @cliente_id,
        N'TEST-AUTH-016B',
        N'Proyecto a desactivar TEST 016'
    );

    SET @proyecto_baja = SCOPE_IDENTITY();


    INSERT INTO seguridad.usuario
        (email, nombre)
    VALUES
        (N'test016.projectdisable@siei.local',
         N'Usuario proyecto baja');

    SET @usuario_pbaja = SCOPE_IDENTITY();


    INSERT INTO seguridad.usuario_proyecto_rol
    (
        usuario_id,
        proyecto_id,
        rol_id
    )
    VALUES
    (
        @usuario_pbaja,
        @proyecto_baja,
        @rol_viewer
    );

    SET @upr_pbaja = SCOPE_IDENTITY();


    UPDATE nucleo.proyecto
    SET activo = 0,
        updated_at = SYSUTCDATETIME()
    WHERE id = @proyecto_baja;


    IF EXISTS
    (
        SELECT 1
        FROM seguridad.usuario_proyecto_rol
        WHERE id = @upr_pbaja
          AND activo = 1
    )
        THROW 53190,
        'FAIL: acceso siguio activo al desactivar proyecto.',
        1;


    IF EXISTS
    (
        SELECT 1
        FROM seguridad.vw_acceso_proyecto
        WHERE usuario_id = @usuario_pbaja
          AND proyecto_id = @proyecto_baja
    )
        THROW 53191,
        'FAIL: proyecto inactivo sigue apareciendo en acceso efectivo.',
        1;


    PRINT 'PASS 9: desactivar proyecto desactivo automaticamente sus accesos.';

    ROLLBACK TRANSACTION;

END TRY
BEGIN CATCH

    IF XACT_STATE() <> 0
        ROLLBACK TRANSACTION;

    PRINT 'FAIL CASO 9.';
    PRINT ERROR_MESSAGE();

END CATCH;


PRINT '=========================================';
PRINT 'FIN TEST 016';
PRINT '=========================================';
