/*
===============================================================================
SIEI
MIGRACION 002 - AUTENTICACION / USUARIOS / ROLES / ACCESO POR PROYECTO
===============================================================================

OBJETIVO
--------
1. Registrar usuarios autenticados externamente.
2. Definir tres roles:
      ADMIN
      EDITOR
      VIEWER
3. Permitir que un usuario tenga diferente rol por proyecto.
4. Permitir un ADMIN global del sistema.
5. Mantener historial mediante activo = 0.
6. Preparar el modelo para autenticacion OIDC / Microsoft Entra ID.

IMPORTANTE
----------
- SIEI NO almacena contraseñas.
- auth_issuer + auth_subject identifican al usuario en el proveedor externo.
- La autorizacion efectiva se aplicara posteriormente desde el backend.
- es_admin_sistema NO es un cuarto rol:
  significa que el usuario tiene privilegios ADMIN sobre todos los proyectos.
===============================================================================
*/

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO


/* ============================================================================
   1. ESQUEMA SEGURIDAD
   ============================================================================ */

IF NOT EXISTS (
    SELECT 1
    FROM sys.schemas
    WHERE name = N'seguridad'
)
BEGIN
    EXEC(N'CREATE SCHEMA seguridad AUTHORIZATION dbo;');
END
GO


/* ============================================================================
   2. ROLES
   ============================================================================ */

CREATE TABLE seguridad.rol
(
    id                  BIGINT IDENTITY(1,1) NOT NULL,
    codigo              NVARCHAR(20)         NOT NULL,
    nombre              NVARCHAR(100)        NOT NULL,
    descripcion         NVARCHAR(300)        NULL,

    /*
       Permisos base.

       puede_escribir:
           crear / modificar informacion de ingenieria.

       puede_desactivar:
           realizar bajas logicas de informacion.

       puede_administrar:
           usuarios, accesos y configuracion administrativa.
    */
    puede_escribir      BIT                  NOT NULL,
    puede_desactivar    BIT                  NOT NULL,
    puede_administrar   BIT                  NOT NULL,

    created_at          DATETIME2            NOT NULL
        CONSTRAINT DF_seg_rol_created_at
        DEFAULT SYSUTCDATETIME(),

    CONSTRAINT PK_seg_rol
        PRIMARY KEY (id),

    CONSTRAINT UQ_seg_rol_codigo
        UNIQUE (codigo),

    CONSTRAINT CK_seg_rol_codigo
        CHECK (codigo IN (N'ADMIN', N'EDITOR', N'VIEWER'))
);
GO


INSERT INTO seguridad.rol
(
    codigo,
    nombre,
    descripcion,
    puede_escribir,
    puede_desactivar,
    puede_administrar
)
VALUES
(
    N'ADMIN',
    N'Administrador',
    N'Acceso completo al proyecto.',
    1,
    1,
    1
),
(
    N'EDITOR',
    N'Editor',
    N'Puede crear y modificar informacion de ingenieria.',
    1,
    0,
    0
),
(
    N'VIEWER',
    N'Visualizador',
    N'Acceso de solo lectura.',
    0,
    0,
    0
);
GO


/* ============================================================================
   2b. PROTECCION DE LOS ROLES ESTRUCTURALES
   ============================================================================

   ADMIN, EDITOR y VIEWER no son datos de configuracion: son parte de la
   estructura del modelo de autorizacion. Todo el sistema asume que existen.

   Borrar cualquiera de ellos rompe la autorizacion de forma silenciosa:

     - ADMIN  -> vw_acceso_proyecto deja de resolver el rol de los
                 administradores globales (es_admin_sistema = 1).
     - EDITOR
       VIEWER -> las asignaciones que los referencian quedarian sin rol.

   FK_seg_upr_rol solo bloquea el borrado cuando existe al menos una
   asignacion que referencia ese rol. En un sistema donde todavia no hay
   asignaciones -o donde solo se usan dos de los tres roles- el DELETE
   pasaria sin error. Este trigger cierra esa via.

   POR QUE RECHAZA TODO DELETE, SIN CONDICION:

   CK_seg_rol_codigo restringe codigo a exactamente ADMIN, EDITOR y VIEWER.
   No existe -ni puede existir- una fila en seguridad.rol que no sea uno de
   los tres roles estructurales, de modo que cualquier DELETE sobre esta
   tabla es necesariamente el borrado de un rol estructural.

   Se usa INSTEAD OF DELETE: el borrado nunca llega a ejecutarse, en lugar
   de ejecutarse y deshacerse despues.

   Si en el futuro se admitieran roles adicionales no estructurales, habria
   que ampliar CK_seg_rol_codigo y, a la vez, condicionar este trigger para
   permitir el borrado de esos roles nuevos.
   ============================================================================ */

CREATE TRIGGER seguridad.TR_rol_proteger_roles_sistema
ON seguridad.rol
INSTEAD OF DELETE
AS
BEGIN
    SET NOCOUNT ON;

    THROW 52010,
    'Los roles ADMIN, EDITOR y VIEWER son roles estructurales de SIEI y no pueden eliminarse.',
    1;
END
GO


/* ============================================================================
   3. USUARIO
   ============================================================================ */

CREATE TABLE seguridad.usuario
(
    id                  BIGINT IDENTITY(1,1) NOT NULL,

    /*
       Identidad funcional dentro de SIEI.
    */
    email               NVARCHAR(320)        NOT NULL,
    nombre              NVARCHAR(200)        NOT NULL,

    /*
       Identidad del proveedor externo.

       En un JWT / OIDC:

           auth_issuer  <- claim "iss"
           auth_subject <- claim "sub"

       Pueden permanecer NULL mientras el usuario haya sido
       pre-registrado pero todavia no haya iniciado sesion.
    */
    auth_issuer         NVARCHAR(500)        NULL,
    auth_subject        NVARCHAR(200)        NULL,

    /*
       ADMIN GLOBAL DEL SISTEMA.

       0:
           necesita una asignacion explicita a cada proyecto.

       1:
           tiene acceso ADMIN a todos los proyectos activos.
    */
    es_admin_sistema    BIT                  NOT NULL
        CONSTRAINT DF_seg_usuario_admin_sistema
        DEFAULT (0),

    activo              BIT                  NOT NULL
        CONSTRAINT DF_seg_usuario_activo
        DEFAULT (1),

    created_at          DATETIME2            NOT NULL
        CONSTRAINT DF_seg_usuario_created_at
        DEFAULT SYSUTCDATETIME(),

    updated_at          DATETIME2            NULL,

    CONSTRAINT PK_seg_usuario
        PRIMARY KEY (id),

    /*
       La identidad externa debe tener ambos valores
       o ninguno.
    */
    CONSTRAINT CK_seg_usuario_auth_identity
        CHECK
        (
            (auth_issuer IS NULL AND auth_subject IS NULL)
            OR
            (auth_issuer IS NOT NULL AND auth_subject IS NOT NULL)
        )
);
GO


/*
   Solo puede existir un usuario ACTIVO con el mismo email.

   Un usuario antiguo inactivo puede conservar el email
   como parte de su historial.
*/
CREATE UNIQUE INDEX UX_seg_usuario_email_activo
    ON seguridad.usuario (email)
    WHERE activo = 1;
GO


/*
   Una identidad autenticada externa solo puede pertenecer
   a un usuario ACTIVO.
*/
CREATE UNIQUE INDEX UX_seg_usuario_auth_activo
    ON seguridad.usuario (auth_issuer, auth_subject)
    WHERE auth_subject IS NOT NULL
      AND activo = 1;
GO


/* ============================================================================
   4. USUARIO - PROYECTO - ROL
   ============================================================================ */

CREATE TABLE seguridad.usuario_proyecto_rol
(
    id                  BIGINT IDENTITY(1,1) NOT NULL,

    usuario_id          BIGINT               NOT NULL,
    proyecto_id         BIGINT               NOT NULL,
    rol_id              BIGINT               NOT NULL,

    /*
       Permite conservar asignaciones historicas.
    */
    activo              BIT                  NOT NULL
        CONSTRAINT DF_seg_upr_activo
        DEFAULT (1),

    created_at          DATETIME2            NOT NULL
        CONSTRAINT DF_seg_upr_created_at
        DEFAULT SYSUTCDATETIME(),

    updated_at          DATETIME2            NULL,

    CONSTRAINT PK_seg_usuario_proyecto_rol
        PRIMARY KEY (id),

    CONSTRAINT FK_seg_upr_usuario
        FOREIGN KEY (usuario_id)
        REFERENCES seguridad.usuario (id),

    CONSTRAINT FK_seg_upr_proyecto
        FOREIGN KEY (proyecto_id)
        REFERENCES nucleo.proyecto (id),

    CONSTRAINT FK_seg_upr_rol
        FOREIGN KEY (rol_id)
        REFERENCES seguridad.rol (id)
);
GO


/*
   Un usuario solo puede tener UNA asignacion ACTIVA
   en un proyecto.

   Ejemplo permitido:

       Juan / Proyecto 620 / EDITOR / activo = 0
       Juan / Proyecto 620 / ADMIN  / activo = 1

   De esa manera conservamos el historial.
*/
CREATE UNIQUE INDEX UX_seg_upr_usuario_proyecto_activo
    ON seguridad.usuario_proyecto_rol
       (usuario_id, proyecto_id)
    WHERE activo = 1;
GO


CREATE INDEX IX_seg_upr_proyecto
    ON seguridad.usuario_proyecto_rol
       (proyecto_id, activo, usuario_id);
GO


CREATE INDEX IX_seg_upr_usuario
    ON seguridad.usuario_proyecto_rol
       (usuario_id, activo, proyecto_id);
GO


/* ============================================================================
   5. VALIDACION DE ASIGNACIONES ACTIVAS
   ============================================================================ */

CREATE TRIGGER seguridad.TR_usuario_proyecto_rol_validar
ON seguridad.usuario_proyecto_rol
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    /*
       No necesitamos validar las filas historicas inactivas.
    */
    IF NOT EXISTS (
        SELECT 1
        FROM inserted
        WHERE activo = 1
    )
        RETURN;


    /*
       Usuario activo requerido.
    */
    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN seguridad.usuario u
          ON u.id = i.usuario_id
        WHERE i.activo = 1
          AND u.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;

        THROW 52001,
        'No se puede asignar acceso a un USUARIO inactivo.',
        1;
    END;


    /*
       Proyecto activo requerido.
    */
    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN nucleo.proyecto p
          ON p.id = i.proyecto_id
        WHERE i.activo = 1
          AND p.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;

        THROW 52002,
        'No se puede asignar acceso a un PROYECTO inactivo.',
        1;
    END;
END
GO


/* ============================================================================
   6. DESACTIVAR USUARIO -> DESACTIVAR SUS ACCESOS
   ============================================================================ */

CREATE TRIGGER seguridad.TR_usuario_desactivar_accesos
ON seguridad.usuario
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT UPDATE(activo)
        RETURN;


    UPDATE upr
    SET
        upr.activo = 0,
        upr.updated_at = SYSUTCDATETIME()
    FROM seguridad.usuario_proyecto_rol upr
    JOIN inserted i
      ON i.id = upr.usuario_id
    JOIN deleted d
      ON d.id = i.id
    WHERE d.activo = 1
      AND i.activo = 0
      AND upr.activo = 1;
END
GO


/* ============================================================================
   7. DESACTIVAR PROYECTO -> DESACTIVAR SUS ACCESOS
   ============================================================================ */

CREATE TRIGGER nucleo.TR_proyecto_desactivar_accesos
ON nucleo.proyecto
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT UPDATE(activo)
        RETURN;


    UPDATE upr
    SET
        upr.activo = 0,
        upr.updated_at = SYSUTCDATETIME()
    FROM seguridad.usuario_proyecto_rol upr
    JOIN inserted i
      ON i.id = upr.proyecto_id
    JOIN deleted d
      ON d.id = i.id
    WHERE d.activo = 1
      AND i.activo = 0
      AND upr.activo = 1;
END
GO


/* ============================================================================
   8. VISTA DE ACCESO EFECTIVO
   ============================================================================

   Esta vista sera muy util para el futuro backend.

   Para un usuario normal:
       devuelve solamente proyectos asignados.

   Para es_admin_sistema = 1:
       devuelve TODOS los proyectos activos como ADMIN.
   ============================================================================ */

CREATE VIEW seguridad.vw_acceso_proyecto
AS
SELECT
    u.id AS usuario_id,

    u.email,

    u.nombre,

    p.id AS proyecto_id,

    p.codigo_proyecto,

    CASE
        WHEN u.es_admin_sistema = 1
            THEN rol_admin.id
        ELSE r.id
    END AS rol_id,

    CASE
        WHEN u.es_admin_sistema = 1
            THEN N'ADMIN'
        ELSE r.codigo
    END AS rol_codigo,

    CAST(
        CASE
            WHEN u.es_admin_sistema = 1 THEN 1
            ELSE r.puede_escribir
        END
        AS BIT
    ) AS puede_escribir,

    CAST(
        CASE
            WHEN u.es_admin_sistema = 1 THEN 1
            ELSE r.puede_desactivar
        END
        AS BIT
    ) AS puede_desactivar,

    CAST(
        CASE
            WHEN u.es_admin_sistema = 1 THEN 1
            ELSE r.puede_administrar
        END
        AS BIT
    ) AS puede_administrar

FROM seguridad.usuario u

CROSS JOIN nucleo.proyecto p

LEFT JOIN seguridad.usuario_proyecto_rol upr
    ON upr.usuario_id = u.id
   AND upr.proyecto_id = p.id
   AND upr.activo = 1

LEFT JOIN seguridad.rol r
    ON r.id = upr.rol_id

/*
   LEFT JOIN, nunca CROSS JOIN.

   Con CROSS JOIN, si la fila del rol ADMIN llegara a faltar, el producto
   cartesiano contra un conjunto vacio dejaba la vista COMPLETA en cero
   filas: ningun usuario -ni siquiera un EDITOR o VIEWER con asignacion
   valida- obtendria acceso. Un dato de catalogo no relacionado podia
   provocar un bloqueo total del sistema.

   Con LEFT JOIN el fallo queda acotado: si faltara la fila ADMIN, solo
   rol_id quedaria NULL para los administradores globales; el resto de la
   vista sigue funcionando con normalidad.

   Ademas, TR_rol_proteger_roles_sistema impide borrar esa fila.
*/
LEFT JOIN seguridad.rol rol_admin
    ON rol_admin.codigo = N'ADMIN'

WHERE u.activo = 1
  AND p.activo = 1

  AND
  (
      u.es_admin_sistema = 1
      OR upr.id IS NOT NULL
  );
GO


/* ============================================================================
   9. VERIFICACION BASICA DE LA MIGRACION
   ============================================================================ */

PRINT '=========================================';
PRINT 'MIGRACION 002 - SEGURIDAD';
PRINT '=========================================';

SELECT
    id,
    codigo,
    nombre,
    puede_escribir,
    puede_desactivar,
    puede_administrar
FROM seguridad.rol
ORDER BY id;

PRINT 'Roles creados: ADMIN / EDITOR / VIEWER.';
PRINT 'Migracion 002 completada.';
PRINT '=========================================';
GO
