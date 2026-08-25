SET NOCOUNT ON;

DECLARE @proyecto_id BIGINT;
DECLARE @rol_editor BIGINT;
DECLARE @rol_viewer BIGINT;

DECLARE @admin_id BIGINT;
DECLARE @editor_id BIGINT;
DECLARE @viewer_id BIGINT;

SELECT @proyecto_id = id
FROM nucleo.proyecto
WHERE codigo_proyecto = N'TEST-001'
  AND activo = 1;

SELECT @rol_editor = id
FROM seguridad.rol
WHERE codigo = N'EDITOR';

SELECT @rol_viewer = id
FROM seguridad.rol
WHERE codigo = N'VIEWER';

IF @proyecto_id IS NULL
    THROW 54001, 'No existe el proyecto TEST-001.', 1;


/* ADMIN GLOBAL */
IF NOT EXISTS (
    SELECT 1
    FROM seguridad.usuario
    WHERE email = N'admin@siei.local'
      AND activo = 1
)
BEGIN
    INSERT INTO seguridad.usuario
        (email, nombre, es_admin_sistema)
    VALUES
        (N'admin@siei.local', N'Administrador Desarrollo', 1);
END;

UPDATE seguridad.usuario
SET es_admin_sistema = 1,
    activo = 1
WHERE email = N'admin@siei.local';

SELECT @admin_id = id
FROM seguridad.usuario
WHERE email = N'admin@siei.local'
  AND activo = 1;


/* EDITOR */
IF NOT EXISTS (
    SELECT 1
    FROM seguridad.usuario
    WHERE email = N'editor@siei.local'
      AND activo = 1
)
BEGIN
    INSERT INTO seguridad.usuario
        (email, nombre, es_admin_sistema)
    VALUES
        (N'editor@siei.local', N'Editor Desarrollo', 0);
END;

SELECT @editor_id = id
FROM seguridad.usuario
WHERE email = N'editor@siei.local'
  AND activo = 1;


/* VIEWER */
IF NOT EXISTS (
    SELECT 1
    FROM seguridad.usuario
    WHERE email = N'viewer@siei.local'
      AND activo = 1
)
BEGIN
    INSERT INTO seguridad.usuario
        (email, nombre, es_admin_sistema)
    VALUES
        (N'viewer@siei.local', N'Viewer Desarrollo', 0);
END;

SELECT @viewer_id = id
FROM seguridad.usuario
WHERE email = N'viewer@siei.local'
  AND activo = 1;


/* EDITOR -> TEST-001 */
IF NOT EXISTS (
    SELECT 1
    FROM seguridad.usuario_proyecto_rol
    WHERE usuario_id = @editor_id
      AND proyecto_id = @proyecto_id
      AND activo = 1
)
BEGIN
    INSERT INTO seguridad.usuario_proyecto_rol
        (usuario_id, proyecto_id, rol_id)
    VALUES
        (@editor_id, @proyecto_id, @rol_editor);
END;


/* VIEWER -> TEST-001 */
IF NOT EXISTS (
    SELECT 1
    FROM seguridad.usuario_proyecto_rol
    WHERE usuario_id = @viewer_id
      AND proyecto_id = @proyecto_id
      AND activo = 1
)
BEGIN
    INSERT INTO seguridad.usuario_proyecto_rol
        (usuario_id, proyecto_id, rol_id)
    VALUES
        (@viewer_id, @proyecto_id, @rol_viewer);
END;


PRINT '=========================================';
PRINT 'USUARIOS DEV CREADOS';
PRINT '=========================================';
PRINT 'admin@siei.local  -> ADMIN SISTEMA';
PRINT 'editor@siei.local -> EDITOR TEST-001';
PRINT 'viewer@siei.local -> VIEWER TEST-001';
PRINT '=========================================';
