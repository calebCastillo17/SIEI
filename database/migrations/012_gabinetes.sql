/* =============================================================================
   012_gabinetes.sql — SIEI
   RIO -> GABINETE: generalizacion real, no solo un cambio de texto en
   frontend. RIO pasa a ser un TIPO de gabinete, no el concepto padre.

   CONTEXTO / DECISION DE NEGOCIO (aprobada explicitamente por el usuario,
   ver docs/DIAGNOSTICO_SENALES_GABINETES.md secciones 5, 26, 31.6, 32):
   Analizando el reporte real de Instrumentos + el Excel 02_MASTER_IO_620
   se encontro evidencia dura de que la columna "RIO" de ese archivo mezcla
   indistintamente gabinetes de E/S remota reales (620-RIO-5012/5013) y un
   gabinete de control de motores (620-PCC-5006) — hoy nucleo.rio no tiene
   ningun campo que distinga esto. Se decidio:
     1. Generalizar nucleo.rio -> nucleo.gabinete, con un tipo explicito
        (cat.cat_tipo_gabinete: RIO / CONTROL / COMUNICACION, extensible).
     2. Agregar gabinete.tag_anterior (mismo patron ya usado en
        instrumento.tag_anterior desde la migracion 004 — nullable, sin
        indice unico, no participa en identidad) para poder importar en el
        futuro la nomenclatura historica de un mismo gabinete si el
        proyecto la tiene, sin usar nomenclatura "WSP" en el modelo.
     3. switch.gabinete_id NULL — relacion opcional (un switch puede estar
        fisicamente dentro de un gabinete modelado o no). El switch sigue
        siendo una entidad distinta del gabinete; un gabinete tipo
        COMUNICACION no lo reemplaza.
     4. caja.gabinete_id NO se crea — decision explicita del usuario: una
        caja de conexiones de campo y un gabinete son entidades fisicas
        independientes; su relacion real se resuelve via
        ruta_conexion/tramo_conexion/punto_conexion, nunca por pertenencia
        estructural.

   VERIFICACION DE DATOS REALES ANTES DE ESTA MIGRACION (ver diagnostico
   seccion 32.1): se consulto nucleo.rio en SIEI_DEV y las 28 filas
   existentes son 100% fixtures de test (TEST-001, tag "RIO-TEST-001" o
   "RIO-<timestamp>-<random>", descripcion literal "RIO de prueba", 27 de
   28 ya inactivas). El proyecto real 22043 tiene CERO filas en
   nucleo.rio. No existe ningun gabinete real cargado en SIEI hoy — el
   backfill de tipo_gabinete_id = RIO para las filas existentes no tiene
   ningun impacto en produccion real.

   TRANSACCION EXPLICITA (desviacion deliberada del patron habitual de las
   migraciones 001-011, que no envuelven todo el archivo en una sola
   transaccion): esta migracion hace bastantes cambios de metadato
   encadenados (rename de tabla, 2 columnas, 3 constraints, 3 indices, mas
   DROP+CREATE de 1 CHECK y 3 TRIGGERS) — un fallo a mitad de camino
   dejaria el esquema en un estado inconsistente dificil de diagnosticar.
   Se usa SET XACT_ABORT ON + BEGIN TRANSACTION/COMMIT envolviendo TODO el
   archivo: verificado empiricamente contra SIEI_DEV que una transaccion
   explicita sobrevive a traves de multiples lotes separados por GO en la
   misma conexion (sqlcmd mantiene una sola conexion para todo el
   script), y que un error en cualquier punto (con XACT_ABORT ON) revierte
   TODO lo ya ejecutado en esa misma transaccion, incluidos CREATE TABLE/
   TRIGGER anteriores en lotes previos. CREATE TRIGGER sigue exigiendo ser
   la unica sentencia de su lote (cada uno en su propio GO), lo cual es
   compatible con una transaccion que abarca varios lotes.

   ALCANCE
   -------
   nucleo.rio -> nucleo.gabinete (rename real), 2 columnas nuevas
   (tag_anterior, tipo_gabinete_id), 1 catalogo nuevo (cat.cat_tipo_gabinete),
   rack.rio_id -> gabinete_id, punto_conexion.rio_id -> gabinete_id,
   switch.gabinete_id nueva (opcional), 1 CHECK reescrito, 3 triggers
   reescritos (misma logica, solo referencias renombradas). No se toca
   001-011.
============================================================================= */

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;
GO


/* ============================================================================
   0. VERIFICACION DE PRECONDICION (fuera de la transaccion principal — si
      esto falla, no hay nada que revertir todavia)
   ============================================================================ */

IF NOT EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'rio'
)
BEGIN
    THROW 55980, 'La migracion 012 requiere que 001_initial_schema.sql se haya aplicado antes (falta nucleo.rio).', 1;
END
GO

IF EXISTS (
    SELECT 1 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'gabinete'
)
BEGIN
    THROW 55981, 'La migracion 012 ya fue aplicada (nucleo.gabinete ya existe).', 1;
END
GO


BEGIN TRANSACTION;
GO


/* ============================================================================
   1. cat.cat_tipo_gabinete (mismo patron que cat.cat_tipo_equipo, migracion 007)
   ============================================================================ */

CREATE TABLE cat.cat_tipo_gabinete (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(20)         NOT NULL,
    nombre          NVARCHAR(100)        NOT NULL,
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_tipo_gabinete_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_tipo_gabinete PRIMARY KEY (id),
    CONSTRAINT UQ_cat_tipo_gabinete_codigo UNIQUE (codigo)
);
GO

INSERT INTO cat.cat_tipo_gabinete (codigo, nombre) VALUES
    (N'RIO', N'E/S Remota'),
    (N'CONTROL', N'Control'),
    (N'COMUNICACION', N'Comunicaciones');
GO


/* ============================================================================
   2. RENAME: tabla nucleo.rio -> nucleo.gabinete, columna tag_rio -> tag_gabinete,
      constraints e indice unico asociados
   ============================================================================ */

EXEC sp_rename N'nucleo.rio', N'gabinete';
GO
EXEC sp_rename N'nucleo.gabinete.tag_rio', N'tag_gabinete', N'COLUMN';
GO
EXEC sp_rename N'nucleo.PK_rio', N'PK_gabinete', N'OBJECT';
GO
EXEC sp_rename N'nucleo.UQ_rio_id_proyecto', N'UQ_gabinete_id_proyecto', N'OBJECT';
GO
EXEC sp_rename N'nucleo.DF_rio_activo', N'DF_gabinete_activo', N'OBJECT';
GO
EXEC sp_rename N'nucleo.DF_rio_created_at', N'DF_gabinete_created_at', N'OBJECT';
GO
EXEC sp_rename N'nucleo.FK_rio_proyecto', N'FK_gabinete_proyecto', N'OBJECT';
GO
EXEC sp_rename N'nucleo.FK_rio_created_by', N'FK_gabinete_created_by', N'OBJECT';
GO
EXEC sp_rename N'nucleo.FK_rio_updated_by', N'FK_gabinete_updated_by', N'OBJECT';
GO

-- Los INDICES se renombran calificados por TABLA (schema.tabla.indice), no
-- por schema.objeto como las constraints — sintaxis distinta, verificada
-- empiricamente contra SIEI_DEV antes de escribir esta migracion (un
-- indice no es un objeto de primer nivel unico por schema, es unico
-- solo dentro de su tabla).
EXEC sp_rename N'nucleo.gabinete.UX_rio_proyecto_tag', N'UX_gabinete_proyecto_tag', N'INDEX';
GO


/* ============================================================================
   3. gabinete.tag_anterior — nullable, SIN indice unico, SIN FK, no
      participa en identidad (mismo patron que instrumento.tag_anterior,
      migracion 004, verificado sin unicidad en produccion). La identidad
      funcional sigue siendo (proyecto_id, tag_gabinete).
   ============================================================================ */

ALTER TABLE nucleo.gabinete ADD tag_anterior NVARCHAR(50) NULL;
GO


/* ============================================================================
   4. gabinete.tipo_gabinete_id — NULL primero, backfill a RIO (unico valor
      real posible hoy, ver verificacion de datos en la cabecera de este
      archivo), despues NOT NULL. Sin DEFAULT permanente: un gabinete
      nuevo debe elegir su tipo explicitamente, nunca heredar uno tacito.
   ============================================================================ */

ALTER TABLE nucleo.gabinete ADD tipo_gabinete_id BIGINT NULL;
GO

UPDATE nucleo.gabinete
SET tipo_gabinete_id = (SELECT id FROM cat.cat_tipo_gabinete WHERE codigo = N'RIO')
WHERE tipo_gabinete_id IS NULL;
GO

ALTER TABLE nucleo.gabinete ALTER COLUMN tipo_gabinete_id BIGINT NOT NULL;
GO

ALTER TABLE nucleo.gabinete ADD CONSTRAINT FK_gabinete_tipo_gabinete
    FOREIGN KEY (tipo_gabinete_id) REFERENCES cat.cat_tipo_gabinete (id);
GO


/* ============================================================================
   5. rack.rio_id -> rack.gabinete_id
   ============================================================================ */

EXEC sp_rename N'nucleo.rack.rio_id', N'gabinete_id', N'COLUMN';
GO
EXEC sp_rename N'nucleo.FK_rack_rio', N'FK_rack_gabinete', N'OBJECT';
GO
EXEC sp_rename N'nucleo.rack.UX_rack_rio_numero', N'UX_rack_gabinete_numero', N'INDEX';
GO


/* ============================================================================
   6. punto_conexion.rio_id -> punto_conexion.gabinete_id, + CHECK XOR
      reescrito (mismo patron de DROP+CREATE explicito que ya usa la
      migracion 009 para constraints/triggers con logica — nunca se confia
      en que un rename de columna reescriba el texto de un CHECK).

      ORDEN IMPORTANTE (encontrado empiricamente al probar contra
      SIEI_DEV): el CHECK debe soltarse ANTES de renombrar la columna que
      referencia — SQL Server rechaza el rename con el error 15336
      "object participates in enforced dependencies" si el CHECK todavia
      la esta usando. La transaccion explicita de esta migracion revirtio
      correctamente TODO al primer intento (verificado: nucleo.rio seguia
      existiendo con sus 28 filas intactas y ningun objeto nuevo quedo
      creado), lo cual confirma que el patron SET XACT_ABORT ON +
      BEGIN/COMMIT TRANSACTION funciona como se esperaba.
   ============================================================================ */

ALTER TABLE nucleo.punto_conexion DROP CONSTRAINT CK_punto_conexion_pertenencia_xor;
GO

EXEC sp_rename N'nucleo.punto_conexion.rio_id', N'gabinete_id', N'COLUMN';
GO
EXEC sp_rename N'nucleo.FK_punto_conexion_rio', N'FK_punto_conexion_gabinete', N'OBJECT';
GO
EXEC sp_rename N'nucleo.punto_conexion.IX_punto_conexion_rio_id', N'IX_punto_conexion_gabinete_id', N'INDEX';
GO

ALTER TABLE nucleo.punto_conexion ADD CONSTRAINT CK_punto_conexion_pertenencia_xor CHECK (
    (CASE WHEN instrumento_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN equipo_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN caja_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN gabinete_id IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN modulo_id IS NULL THEN 0 ELSE 1 END) = 1
);
GO


/* ============================================================================
   7. switch.gabinete_id — relacion OPCIONAL (un switch puede o no estar
      fisicamente dentro de un gabinete modelado). FK compuesta con
      proyecto_id: garantiza que el gabinete pertenezca al mismo proyecto
      del switch (misma proteccion multiproyecto que el resto de nucleo).
      Un gabinete tipo COMUNICACION no reemplaza al switch — son entidades
      distintas que coexisten.
   ============================================================================ */

ALTER TABLE nucleo.switch ADD gabinete_id BIGINT NULL;
GO

ALTER TABLE nucleo.switch ADD CONSTRAINT FK_switch_gabinete
    FOREIGN KEY (gabinete_id, proyecto_id) REFERENCES nucleo.gabinete (id, proyecto_id);
GO


/* ============================================================================
   8. TRIGGERS — DROP + CREATE explicito. Cuerpo IDENTICO al de
      001_initial_schema.sql, unicamente reemplazando las referencias
      textuales "rio_id" -> "gabinete_id" donde corresponde. Ninguna otra
      linea de logica cambia — confirmado con diff conceptual linea por
      linea contra el original antes de escribir este archivo.
   ============================================================================ */

-- -----------------------------------------------------------------------------
-- 8.1 TR_tramo_conexion_validar_secuencia
--     Unico cambio real: linea "p.rio_id IS NULL" -> "p.gabinete_id IS NULL"
--     (punto 3 original: el ultimo tramo debe terminar en un punto de
--     GABINETE o MODULO). Mensaje de error actualizado para reflejar el
--     nombre nuevo, sin cambiar el codigo de error (51007).
-- -----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = N'TR_tramo_conexion_validar_secuencia')
BEGIN
    THROW 55982, 'Falta TR_tramo_conexion_validar_secuencia (revisar 001_initial_schema.sql).', 1;
END
GO

DROP TRIGGER nucleo.TR_tramo_conexion_validar_secuencia;
GO

CREATE TRIGGER nucleo.TR_tramo_conexion_validar_secuencia ON nucleo.tramo_conexion
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @rutas TABLE (ruta_conexion_id BIGINT PRIMARY KEY);
    INSERT INTO @rutas
        SELECT DISTINCT ruta_conexion_id FROM inserted
        UNION
        SELECT DISTINCT ruta_conexion_id FROM deleted;

    IF NOT EXISTS (SELECT 1 FROM @rutas) RETURN;

    DECLARE @activos TABLE (
        tramo_id            BIGINT PRIMARY KEY,
        ruta_conexion_id    BIGINT   NOT NULL,
        numero_orden        SMALLINT NOT NULL,
        punto_origen_id     BIGINT   NOT NULL,
        punto_destino_id    BIGINT   NOT NULL,
        par_conductor_id    BIGINT   NOT NULL,
        rn                  BIGINT   NOT NULL,
        total               INT      NOT NULL,
        siguiente_origen    BIGINT   NULL
    );

    INSERT INTO @activos (tramo_id, ruta_conexion_id, numero_orden, punto_origen_id, punto_destino_id, par_conductor_id, rn, total, siguiente_origen)
    SELECT t.id, t.ruta_conexion_id, t.numero_orden, t.punto_origen_id, t.punto_destino_id, t.par_conductor_id,
           ROW_NUMBER() OVER (PARTITION BY t.ruta_conexion_id ORDER BY t.numero_orden),
           COUNT(*)     OVER (PARTITION BY t.ruta_conexion_id),
           LEAD(t.punto_origen_id) OVER (PARTITION BY t.ruta_conexion_id ORDER BY t.numero_orden)
    FROM nucleo.tramo_conexion t
    WHERE t.activo = 1 AND t.ruta_conexion_id IN (SELECT ruta_conexion_id FROM @rutas);

    IF EXISTS (SELECT 1 FROM @activos WHERE numero_orden <> rn)
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51004, 'numero_orden no es consecutivo dentro de la ruta.', 1;
    END

    IF EXISTS (SELECT 1 FROM @activos WHERE rn < total AND punto_destino_id <> siguiente_origen)
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51005, 'El destino de un tramo no coincide con el origen del siguiente.', 1;
    END

    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.ruta_conexion r ON r.id = a.ruta_conexion_id
        JOIN nucleo.senal s ON s.id = r.senal_id
        JOIN nucleo.punto_conexion p ON p.id = a.punto_origen_id
        WHERE a.rn = 1
          AND ((s.instrumento_id IS NOT NULL AND ISNULL(p.instrumento_id, -1) <> s.instrumento_id)
            OR (s.equipo_id      IS NOT NULL AND ISNULL(p.equipo_id, -1)      <> s.equipo_id))
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51006, 'El origen del primer tramo no corresponde al dueño real de la senal.', 1;
    END

    IF EXISTS (
        SELECT 1 FROM @activos a
        JOIN nucleo.punto_conexion p ON p.id = a.punto_destino_id
        WHERE a.rn = a.total AND p.gabinete_id IS NULL AND p.modulo_id IS NULL
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51007, 'El ultimo tramo no termina en un punto de GABINETE o MODULO.', 1;
    END

    -- Punto 4: recursos usados por un tramo activo deben estar activos
    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.punto_conexion po ON po.id = a.punto_origen_id
        JOIN nucleo.punto_conexion pd ON pd.id = a.punto_destino_id
        JOIN nucleo.par_conductor pc ON pc.id = a.par_conductor_id
        JOIN nucleo.cable cb ON cb.id = pc.cable_id
        WHERE po.activo = 0 OR pd.activo = 0 OR cb.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51015, 'Un tramo activo no puede usar puntos de conexion o cable inactivos.', 1;
    END

    -- Punto 6: un nodo intermedio (no es el ultimo tramo) debe ser CAJA
    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.punto_conexion p ON p.id = a.punto_destino_id
        WHERE a.rn < a.total AND p.caja_id IS NULL
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51017, 'Un nodo intermedio de la ruta debe corresponder a una CAJA.', 1;
    END

    -- Punto 4(b): un tramo activo requiere que su ruta padre este activa
    IF EXISTS (
        SELECT 1
        FROM @activos a
        JOIN nucleo.ruta_conexion r ON r.id = a.ruta_conexion_id
        WHERE r.activo = 0
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51023, 'Un TRAMO_CONEXION activo requiere una RUTA_CONEXION activa.', 1;
    END
END
GO


-- -----------------------------------------------------------------------------
-- 8.2 TR_senal_validar_canal_ruta
--     Unico cambio real: "pd.rio_id"/"rk.rio_id" -> "pd.gabinete_id"/
--     "rk.gabinete_id" en la validacion de que el canal asignado coincida
--     con el GABINETE/modulo del destino fisico de la ruta.
-- -----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = N'TR_senal_validar_canal_ruta')
BEGIN
    THROW 55983, 'Falta TR_senal_validar_canal_ruta (revisar 001_initial_schema.sql).', 1;
END
GO

DROP TRIGGER nucleo.TR_senal_validar_canal_ruta;
GO

CREATE TRIGGER nucleo.TR_senal_validar_canal_ruta ON nucleo.senal
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT (UPDATE(canal_id) OR UPDATE(activo) OR UPDATE(instrumento_id) OR UPDATE(equipo_id)) RETURN;

    -- (a) + (b): fila NUEVA (INSERT, sin equivalente en deleted), o canal_id
    -- cambio de valor de verdad, o la senal se reactivo (0 -> 1) conservando
    -- un canal_id ya asignado — en los tres casos hay que revalidar canal/ruta.
    DECLARE @cambios TABLE (senal_id BIGINT PRIMARY KEY, canal_id BIGINT NULL);
    INSERT INTO @cambios (senal_id, canal_id)
    SELECT i.id, i.canal_id
    FROM inserted i
    LEFT JOIN deleted d ON d.id = i.id
    WHERE i.activo = 1
      AND i.canal_id IS NOT NULL
      AND ( d.id IS NULL                                       -- fila nueva (INSERT)
         OR ISNULL(i.canal_id, -1) <> ISNULL(d.canal_id, -1)    -- canal_id cambio de valor de verdad
         OR (d.activo = 0 AND i.activo = 1) );                  -- o la senal se reactivo (0 -> 1)

    IF EXISTS (SELECT 1 FROM @cambios)
    BEGIN
        -- Punto 3: canal y su modulo deben estar activos
        IF EXISTS (
            SELECT 1
            FROM @cambios c
            JOIN nucleo.canal ch ON ch.id = c.canal_id
            JOIN nucleo.modulo m ON m.id = ch.modulo_id
            WHERE ch.activo = 0 OR m.activo = 0
        )
        BEGIN
            ROLLBACK TRANSACTION;
            THROW 51014, 'Una senal activa no puede usar un CANAL o MODULO inactivo.', 1;
        END

        DECLARE @ultimo TABLE (senal_id BIGINT PRIMARY KEY, punto_destino_id BIGINT NOT NULL);
        INSERT INTO @ultimo (senal_id, punto_destino_id)
        SELECT x.senal_id, x.punto_destino_id
        FROM (
            SELECT r.senal_id, t.punto_destino_id,
                   ROW_NUMBER() OVER (PARTITION BY r.senal_id ORDER BY t.numero_orden DESC) AS rn
            FROM @cambios c
            JOIN nucleo.ruta_conexion r ON r.senal_id = c.senal_id AND r.activo = 1
            JOIN nucleo.tramo_conexion t ON t.ruta_conexion_id = r.id AND t.activo = 1
        ) x
        WHERE x.rn = 1;

        IF EXISTS (
            SELECT 1
            FROM @cambios c
            JOIN @ultimo u ON u.senal_id = c.senal_id
            JOIN nucleo.punto_conexion pd ON pd.id = u.punto_destino_id
            JOIN nucleo.canal ch ON ch.id = c.canal_id
            WHERE (pd.modulo_id IS NOT NULL AND pd.modulo_id <> ch.modulo_id)
               OR (pd.gabinete_id IS NOT NULL AND pd.gabinete_id <> (
                      SELECT rk.gabinete_id
                      FROM nucleo.modulo m2
                      JOIN nucleo.slot sl2 ON sl2.id = m2.slot_id
                      JOIN nucleo.rack rk  ON rk.id = sl2.rack_id
                      WHERE m2.id = ch.modulo_id
                   ))
        )
        BEGIN
            ROLLBACK TRANSACTION;
            THROW 51011, 'El canal asignado no coincide con el GABINETE/modulo del destino fisico de la ruta.', 1;
        END
    END

    -- (c) Punto 5: cambio de dueño con ruta activa
    DECLARE @cambios_dueno TABLE (senal_id BIGINT PRIMARY KEY, instrumento_id BIGINT NULL, equipo_id BIGINT NULL);
    INSERT INTO @cambios_dueno (senal_id, instrumento_id, equipo_id)
    SELECT i.id, i.instrumento_id, i.equipo_id
    FROM inserted i
    JOIN deleted d ON d.id = i.id
    WHERE i.activo = 1
      AND ( ISNULL(i.instrumento_id, -1) <> ISNULL(d.instrumento_id, -1)
         OR ISNULL(i.equipo_id, -1)      <> ISNULL(d.equipo_id, -1) );

    IF EXISTS (
        SELECT 1
        FROM @cambios_dueno cd
        JOIN nucleo.ruta_conexion r ON r.senal_id = cd.senal_id AND r.activo = 1
        JOIN nucleo.tramo_conexion t ON t.ruta_conexion_id = r.id AND t.activo = 1 AND t.numero_orden = 1
        JOIN nucleo.punto_conexion p ON p.id = t.punto_origen_id
        WHERE (cd.instrumento_id IS NOT NULL AND ISNULL(p.instrumento_id, -1) <> cd.instrumento_id)
           OR (cd.equipo_id      IS NOT NULL AND ISNULL(p.equipo_id, -1)      <> cd.equipo_id)
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51016, 'No se puede cambiar el dueño de una senal con ruta activa cuyo primer punto no corresponda al nuevo dueño.', 1;
    END
END
GO


-- -----------------------------------------------------------------------------
-- 8.3 TR_tramo_conexion_validar_canal_ruta
--     Lado "cambia la ruta" de la misma coherencia canal <-> ruta.
--     Unico cambio real: "pd.rio_id"/"rk.rio_id" -> "pd.gabinete_id"/
--     "rk.gabinete_id".
-- -----------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = N'TR_tramo_conexion_validar_canal_ruta')
BEGIN
    THROW 55984, 'Falta TR_tramo_conexion_validar_canal_ruta (revisar 001_initial_schema.sql).', 1;
END
GO

DROP TRIGGER nucleo.TR_tramo_conexion_validar_canal_ruta;
GO

CREATE TRIGGER nucleo.TR_tramo_conexion_validar_canal_ruta ON nucleo.tramo_conexion
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @rutas TABLE (ruta_conexion_id BIGINT PRIMARY KEY);
    INSERT INTO @rutas
        SELECT DISTINCT ruta_conexion_id FROM inserted
        UNION
        SELECT DISTINCT ruta_conexion_id FROM deleted;

    IF NOT EXISTS (SELECT 1 FROM @rutas) RETURN;

    DECLARE @ultimo TABLE (ruta_conexion_id BIGINT PRIMARY KEY, punto_destino_id BIGINT NOT NULL);
    INSERT INTO @ultimo (ruta_conexion_id, punto_destino_id)
    SELECT x.ruta_conexion_id, x.punto_destino_id
    FROM (
        SELECT t.ruta_conexion_id, t.punto_destino_id,
               ROW_NUMBER() OVER (PARTITION BY t.ruta_conexion_id ORDER BY t.numero_orden DESC) AS rn
        FROM nucleo.tramo_conexion t
        WHERE t.activo = 1 AND t.ruta_conexion_id IN (SELECT ruta_conexion_id FROM @rutas)
    ) x
    WHERE x.rn = 1;

    IF EXISTS (
        SELECT 1
        FROM @ultimo u
        JOIN nucleo.ruta_conexion r ON r.id = u.ruta_conexion_id AND r.activo = 1
        JOIN nucleo.senal s  ON s.id = r.senal_id AND s.canal_id IS NOT NULL
        JOIN nucleo.canal ch ON ch.id = s.canal_id
        JOIN nucleo.punto_conexion pd ON pd.id = u.punto_destino_id
        LEFT JOIN nucleo.modulo m2 ON m2.id = ch.modulo_id
        LEFT JOIN nucleo.slot  sl2 ON sl2.id = m2.slot_id
        LEFT JOIN nucleo.rack  rk  ON rk.id = sl2.rack_id
        WHERE (pd.modulo_id IS NOT NULL AND pd.modulo_id <> ch.modulo_id)
           OR (pd.gabinete_id IS NOT NULL AND pd.gabinete_id <> rk.gabinete_id)
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51012, 'El destino fisico de la ruta no coincide con el GABINETE/modulo del canal asignado.', 1;
    END
END
GO


COMMIT TRANSACTION;
GO
