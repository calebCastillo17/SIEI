/*
===============================================================================
SIEI
MIGRACION 003 - AUDITORIA DE USUARIO (created_by / updated_by)
===============================================================================

OBJETIVO
--------
Registrar QUE USUARIO creo y que usuario modifico por ultima vez cada
registro de informacion de ingenieria del esquema nucleo.

POR QUE AHORA
-------------
La migracion 001 difirio explicitamente created_by/updated_by "hasta que
exista una tabla de usuarios". La migracion 002 creo seguridad.usuario, de
modo que esa condicion ya se cumple.

Se aplica antes de construir el backend porque es el momento mas barato: las
tablas del nucleo estan practicamente vacias. Hacerlo despues obligaria a un
backfill con nulos y se perderia la trazabilidad de todo lo cargado en el
intervalo -precisamente en un sistema cuyo proposito es controlar entregables
y revisiones de ingenieria, donde "quien modifico esta senal" es una pregunta
de negocio, no un lujo tecnico.


SEMANTICA DE LOS CAMPOS
-----------------------

created_by  BIGINT NULL  -> FK a seguridad.usuario(id)
updated_by  BIGINT NULL  -> FK a seguridad.usuario(id)

1. AMBOS SON NULLABLE, Y ESO ES INTENCIONAL.

   NULL significa "no atribuible a un usuario humano de SIEI". Casos
   legitimos y esperados:

     - migraciones y scripts de esquema;
     - importaciones masivas (por ejemplo, carga inicial desde los Excel
       de referencia);
     - informacion preexistente cargada antes de que existiera el modulo
       de usuarios;
     - operaciones de mantenimiento ejecutadas directamente en la base.

   NO se agrega NOT NULL ni un valor centinela tipo "usuario sistema":
   un NULL honesto es preferible a atribuir a un usuario ficticio un
   cambio que ningun humano hizo.

2. EL BACKEND DEBE INFORMARLOS EN TODO CAMBIO HUMANO.

   Para cualquier operacion originada en una sesion autenticada, el backend
   es responsable de escribir:

     - created_by en el INSERT;
     - updated_by en cada UPDATE.

   La base de datos NO puede deducirlo: no conoce la identidad del usuario
   de aplicacion (no hay RLS ni SESSION_CONTEXT en esta etapa). Por eso
   estos campos son una responsabilidad del backend, igual que updated_at.

3. RELACION CON created_at / updated_at (SIN CAMBIOS).

   created_at  -> lo genera SQL Server (DEFAULT SYSUTCDATETIME()). No se toca.

   updated_at  -> normalmente lo gestiona el backend.

                  EXCEPCION: las cascadas automaticas de los triggers si lo
                  escriben, porque en esas filas no hay una sentencia de
                  aplicacion que pueda hacerlo. Por ejemplo, al desactivar
                  un usuario o un proyecto, los triggers de la migracion 002
                  actualizan seguridad.usuario_proyecto_rol.updated_at.

                  En esas cascadas updated_by queda como este NULL o
                  conserva su valor anterior: el cambio lo origino una regla
                  del motor, no una accion directa del usuario sobre esa
                  fila concreta.

   Esta migracion NO modifica ninguna columna created_at/updated_at
   existente ni agrega triggers que las mantengan.

4. NO SE APLICA AL ESQUEMA cat.

   Los catalogos universales (cat.*) son datos de referencia del sistema,
   no informacion de ingenieria de un proyecto. Quedan fuera del alcance.


ALCANCE
-------
Las 20 tablas del esquema nucleo. Solo se agregan columnas y claves foraneas:
no se modifican columnas, restricciones, indices ni triggers existentes.
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
   VERIFICACION DE PRECONDICION

   003 depende de 002: seguridad.usuario debe existir antes de crear las FK.
   ============================================================================ */

IF NOT EXISTS
(
    SELECT 1
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'seguridad'
      AND t.name = N'usuario'
)
BEGIN
    THROW 54001,
    'La migracion 003 requiere que 002_auth_users_roles.sql se haya aplicado antes (falta seguridad.usuario).',
    1;
END
GO


/* ============================================================================
   1. RAIZ: CLIENTE / PROYECTO
   ============================================================================ */

ALTER TABLE nucleo.cliente ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_cliente_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_cliente_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO

ALTER TABLE nucleo.proyecto ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_proyecto_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_proyecto_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO


/* ============================================================================
   2. ORIGEN DE SENALES: INSTRUMENTO / EQUIPO
   ============================================================================ */

ALTER TABLE nucleo.instrumento ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_instrumento_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_instrumento_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO

ALTER TABLE nucleo.equipo ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_equipo_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_equipo_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO


/* ============================================================================
   3. SENAL
   ============================================================================ */

ALTER TABLE nucleo.senal ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_senal_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_senal_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO


/* ============================================================================
   4. JERARQUIA FISICA DE I/O: RIO / RACK / SLOT / MODULO / CANAL
   ============================================================================ */

ALTER TABLE nucleo.rio ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_rio_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_rio_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO

ALTER TABLE nucleo.rack ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_rack_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_rack_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO

ALTER TABLE nucleo.slot ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_slot_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_slot_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO

ALTER TABLE nucleo.modulo ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_modulo_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_modulo_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO

/*
   NOTA sobre nucleo.canal:

   Los canales los genera automaticamente TR_modulo_generar_canales al
   instalar o reconfigurar un modulo. Esas filas naceran con
   created_by = NULL, que es exactamente la semantica correcta: las creo una
   regla del motor, no un usuario. El backend puede informar updated_by si
   despues un humano modifica la fila.
*/
ALTER TABLE nucleo.canal ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_canal_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_canal_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO


/* ============================================================================
   5. COMUNICACIONES: SWITCH / PUERTO / ENLACE_COM
   ============================================================================ */

ALTER TABLE nucleo.switch ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_switch_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_switch_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO

ALTER TABLE nucleo.puerto ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_puerto_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_puerto_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO

ALTER TABLE nucleo.enlace_com ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_enlace_com_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_enlace_com_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO


/* ============================================================================
   6. CONEXIONADO FISICO: CAJA / CABLE / PAR_CONDUCTOR / PUNTO_CONEXION
   ============================================================================ */

ALTER TABLE nucleo.caja ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_caja_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_caja_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO

ALTER TABLE nucleo.cable ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_cable_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_cable_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO

ALTER TABLE nucleo.par_conductor ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_par_conductor_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_par_conductor_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO

ALTER TABLE nucleo.punto_conexion ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_punto_conexion_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_punto_conexion_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO


/* ============================================================================
   7. RUTA DE CONEXIONADO: RUTA_CONEXION / TRAMO_CONEXION
   ============================================================================ */

ALTER TABLE nucleo.ruta_conexion ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_ruta_conexion_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_ruta_conexion_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO

/*
   NOTA sobre nucleo.tramo_conexion:

   La desactivacion en cascada (SENAL -> RUTA_CONEXION -> TRAMO_CONEXION) la
   ejecutan los triggers de 001. Esas filas conservaran su updated_by
   anterior: el cambio de estado lo origino una regla del motor, no una
   accion directa del usuario sobre cada tramo.
*/
ALTER TABLE nucleo.tramo_conexion ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_tramo_conexion_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_tramo_conexion_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO


/* ============================================================================
   8. LAZO
   ============================================================================ */

ALTER TABLE nucleo.lazo ADD
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    CONSTRAINT FK_lazo_created_by
        FOREIGN KEY (created_by) REFERENCES seguridad.usuario (id),
    CONSTRAINT FK_lazo_updated_by
        FOREIGN KEY (updated_by) REFERENCES seguridad.usuario (id);
GO


/* ============================================================================
   9. VERIFICACION DE LA MIGRACION
   ============================================================================ */

PRINT '=========================================';
PRINT 'MIGRACION 003 - AUDITORIA DE USUARIO';
PRINT '=========================================';

DECLARE @tablas_con_auditoria INT;
DECLARE @fks_auditoria INT;

SELECT @tablas_con_auditoria = COUNT(DISTINCT t.object_id)
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.columns c ON c.object_id = t.object_id
WHERE s.name = N'nucleo'
  AND c.name IN (N'created_by', N'updated_by');

SELECT @fks_auditoria = COUNT(*)
FROM sys.foreign_keys fk
JOIN sys.schemas s ON s.schema_id = fk.schema_id
WHERE s.name = N'nucleo'
  AND (fk.name LIKE N'%_created_by' OR fk.name LIKE N'%_updated_by');

PRINT 'Tablas de nucleo con columnas de auditoria: '
      + CAST(@tablas_con_auditoria AS NVARCHAR(10)) + ' (esperado: 20)';

PRINT 'Claves foraneas de auditoria creadas: '
      + CAST(@fks_auditoria AS NVARCHAR(10)) + ' (esperado: 40)';

IF @tablas_con_auditoria <> 20 OR @fks_auditoria <> 40
BEGIN
    THROW 54002,
    'La migracion 003 no dejo el estado esperado (20 tablas / 40 claves foraneas).',
    1;
END

PRINT 'created_by / updated_by admiten NULL de forma intencional.';
PRINT 'Migracion 003 completada.';
PRINT '=========================================';
GO
