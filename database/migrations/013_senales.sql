/* =============================================================================
   013_senales.sql — SIEI
   nucleo.senal.tag_senal pasa a ser opcional; se agregan codigo_senal
   (referencia legacy/importada), causa_alarma (atributo propio de SIEI),
   tipo_dato_com_id (catalogo nuevo cat.cat_tipo_dato_com) y
   es_loop_powered — los dos ultimos exclusivos de COM/CONTROL
   respectivamente, reforzado en TR_senal_validar_clase.

   CONTEXTO / DECISIONES DE NEGOCIO (aprobadas explicitamente por el
   usuario tras el diseño tecnico exacto documentado en
   docs/DIAGNOSTICO_SENALES_GABINETES.md, seccion 34):

   - tag_senal NOT NULL no representa la ingenieria real: el analisis del
     Excel de referencia (02_MASTER_IO_620.xlsm) mostro que 269/269 señales
     CONTROL tienen un TAG_SENAL derivable, pero solo 46/762 señales COM
     (6%) lo tienen — la mayoria de las COM son registros PLC sin tag real
     ("PALABRA DE ALARMAS 1", "HEARTBEAT", etc.). No se inventan tags para
     COM; tag_senal pasa a NULL sin backfill.

   - codigo_senal (NVARCHAR(20) NULL) es una referencia legacy/importada
     pura — nunca identidad de SIEI (senal.id ya lo es), nunca generada,
     nunca renumerada. El Excel real (MASTER_SENALES.ID_SENAL, union
     exacta de SENALES_CONTROL 269 + SENALES_COM 762 = 1031 filas) tiene
     formato uniforme "###-SIG-######" (14 caracteres), sin duplicados
     dentro de cada hoja ni overlap entre ambas — pero esa evidencia
     proviene de un unico dataset/proyecto. Decision explicita del
     usuario: NO se agrega UNIQUE sobre codigo_senal (bastaria un segundo
     Excel legacy con un duplicado real, no observado aqui pero tampoco
     descartable con una sola muestra, para bloquear una importacion
     legitima). Se agrega en su lugar un indice NO UNICO filtrado
     (IX_senal_proyecto_codigo), util para localizar una señal por su
     referencia legacy sin escanear toda la tabla.

   - causa_alarma (BIT NULL): se inspecciono la formula real de
     MASTER_SENALES.CAUSA_ALARMA en el Excel — es un booleano CALCULADO
     ("=OR(TIPO_IO=\"AI\",\"DI\",\"RTD\",\"IN\")"), no una descripcion
     textual de la causa de una alarma (ese concepto, con ese significado,
     no existe en ninguna hoja del workbook). Decision explicita del
     usuario: en SIEI sera un atributo INDEPENDIENTE de la señal,
     desacoplado deliberadamente de esa formula — sin FK, sin catalogo,
     sin CHECK relacionado con tipo_io_id, sin trigger de derivacion, sin
     generacion automatica, y SIN restriccion de exclusividad por clase
     (puede tener valor tanto en CONTROL como en COM). Semantica:
     NULL = no definido, 0 = no, 1 = si.

   - tipo_dato_com_id / cat.cat_tipo_dato_com: confirmado contra
     SENALES_COM.TIPO_DATO (716/770 filas pobladas) — exactamente 7
     valores reales, sin variantes de mayuscula/espacio, sin errores de
     escritura: BIT (519), REAL (89), DINT (28), WORD (28), UDINT (24),
     UINT (16), DWORD (12). Lista cerrada, mismo patron que
     cat.cat_tipo_io/cat.cat_direccion_com. Exclusivo de COM (CONTROL no
     puede tenerlo) — reforzado en TR_senal_validar_clase, no obligatorio
     para COM (54/770 filas del dataset real no tienen TIPO_DATO).

   - es_loop_powered (BIT NULL): describe el conexionado de una señal
     CONTROL (loop-powered), distinto de una futura
     instrumento.alimentacion_instrumento (alimentacion general del
     instrumento, no existe hoy, fuera de alcance de esta migracion).
     Exclusivo de CONTROL (COM no puede tenerlo) — reforzado en
     TR_senal_validar_clase. No se restringe a tipo_io_id = 'AI' (la
     evidencia del Excel, columna CONEX_TIPO = 'LP', siempre coincide con
     canales de entrada de transmisores PI/LI/ZI/LIC, pero no hay una
     regla de negocio inequivoca que excluya, por ejemplo, un RTD
     loop-powered). CONEX_TIPO tambien tiene los valores BOT_S/BOT_D
     (estacion de botonera simple/doble, confirmado sobre HYO/HYC/HY en
     canales de salida) — concepto DISTINTO de loop-powered, explicitamente
     FUERA de esta migracion (no se crea senal.conex_tipo, no se crea
     ningun catalogo de tipo de botonera, BOT_S/BOT_D NUNCA se interpretan
     como es_loop_powered). Queda documentado como deuda de modelado sin
     destino asignado todavia.

   - TR_senal_validar_clase (linea 1171 de 001_initial_schema.sql) ya es
     el trigger que decide que combinaciones son validas segun
     cat_clase_senal.codigo — se EXTIENDE (DROP + CREATE), no se crea un
     trigger nuevo. Toda su logica existente (tipo_io/canal prohibidos en
     COM, direccion_com prohibido en CONTROL, COM con ruta activa
     prohibido) se preserva exactamente igual; el unico cambio funcional
     es agregar tipo_dato_com_id a la lista de campos que CONTROL no
     puede tener y es_loop_powered a la lista que COM no puede tener,
     mas la guarda de entrada para que el trigger tambien dispare cuando
     solo cambian esas dos columnas nuevas.

   - CK_senal_tipo_dato_com_loop_excl es una defensa de fila simple (sin
     JOIN a catalogo, mismo patron que CK_senal_tipo_io_direccion_excl):
     impide unicamente el estado imposible tipo_dato_com_id Y
     es_loop_powered con valor a la vez. NO intenta resolver
     CONTROL/COM — esa validacion semantica es responsabilidad exclusiva
     del trigger de arriba.

   VERIFICACION DE DATOS REALES (SIEI_DEV, previa a aplicar esta
   migracion): 194 filas en nucleo.senal, 1 activa / 193 inactivas, 98
   CONTROL / 96 COM, TODAS en el proyecto TEST-001 (fixtures de prueba de
   sesiones anteriores, tags con patron "LT-<timestamp>-<random>",
   "COM-<timestamp>-<random>", etc.). El proyecto real 22043 tiene 0
   filas en nucleo.senal. Mismo perfil de riesgo-cero que tenia
   nucleo.rio antes de la migracion 012 — ningun dato de ingenieria real
   se ve afectado por este cambio de nullability/indices.

   ESTRATEGIA TRANSACCIONAL: identica a la de la migracion 012 — SET
   XACT_ABORT ON + transaccion explicita abarcando todos los batches
   (verificado en 012 que sp_rename/ALTER/CREATE TRIGGER participan
   correctamente en una transaccion que abarca multiples GO), aplicada
   con "sqlcmd -b" (aborta al primer error) para que un fallo a mitad de
   camino nunca deje el esquema parcialmente modificado.
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
   0. VERIFICACION DE PRECONDICION E IDEMPOTENCIA
   ============================================================================ */

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns c
    JOIN sys.tables t ON t.object_id = c.object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'senal' AND c.name = N'tag_senal'
)
BEGIN
    THROW 55990, 'La migracion 013 requiere que 001_initial_schema.sql se haya aplicado antes (falta nucleo.senal.tag_senal).', 1;
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns c
    JOIN sys.tables t ON t.object_id = c.object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'senal' AND c.name = N'codigo_senal'
)
BEGIN
    THROW 55991, 'La migracion 013 ya fue aplicada (nucleo.senal.codigo_senal ya existe).', 1;
END
GO


BEGIN TRANSACTION;


/* ============================================================================
   1. tag_senal: NOT NULL -> NULL (sin backfill, conserva valores existentes)
   ============================================================================ */

ALTER TABLE nucleo.senal ALTER COLUMN tag_senal NVARCHAR(80) NULL;
GO


/* ============================================================================
   2. Reemplazar el indice unico de tag_senal para excluir NULL del todo
      (un indice unico FILTRADO de SQL Server excluye directamente las filas
      que no cumplen el predicado — a diferencia de una UNIQUE CONSTRAINT
      plana, que solo tolera un NULL, aqui cualquier cantidad de NULL
      convive libremente porque el predicado las saca de la comprobacion).
   ============================================================================ */

DROP INDEX UX_senal_proyecto_tag ON nucleo.senal;
GO

CREATE UNIQUE INDEX UX_senal_proyecto_tag
    ON nucleo.senal (proyecto_id, tag_senal)
    WHERE tag_senal IS NOT NULL AND activo = 1;
GO


/* ============================================================================
   3. codigo_senal: referencia legacy/importada, opcional, SIN unicidad
      (decision explicita del usuario — ver nota de cabecera). Indice NO
      UNICO filtrado para busqueda por codigo legacy sin escanear la tabla.
   ============================================================================ */

ALTER TABLE nucleo.senal ADD codigo_senal NVARCHAR(20) NULL;
GO

CREATE INDEX IX_senal_proyecto_codigo
    ON nucleo.senal (proyecto_id, codigo_senal)
    WHERE codigo_senal IS NOT NULL;
GO


/* ============================================================================
   4. causa_alarma: atributo propio de SIEI, independiente del Excel — sin
      FK, sin catalogo, sin CHECK, sin restriccion de clase (permitido en
      CONTROL y en COM).
   ============================================================================ */

ALTER TABLE nucleo.senal ADD causa_alarma BIT NULL;
GO


/* ============================================================================
   5. cat.cat_tipo_dato_com — catalogo global nuevo (lista cerrada,
      evidencia real, mismo patron que cat.cat_tipo_io/cat.cat_direccion_com)
   ============================================================================ */

CREATE TABLE cat.cat_tipo_dato_com (
    id          BIGINT IDENTITY(1,1) NOT NULL,
    codigo      NVARCHAR(30)         NOT NULL,
    descripcion NVARCHAR(200)        NULL,
    created_at  DATETIME2            NOT NULL CONSTRAINT DF_cat_tipo_dato_com_created_at DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2            NULL,
    CONSTRAINT PK_cat_tipo_dato_com PRIMARY KEY (id),
    CONSTRAINT UQ_cat_tipo_dato_com_codigo UNIQUE (codigo)
);
GO

INSERT INTO cat.cat_tipo_dato_com (codigo, descripcion) VALUES
    (N'BIT',   N'Un bit (booleano)'),
    (N'WORD',  N'Palabra sin signo de 16 bits'),
    (N'DWORD', N'Palabra sin signo de 32 bits'),
    (N'UINT',  N'Entero sin signo de 16 bits'),
    (N'UDINT', N'Entero sin signo de 32 bits'),
    (N'DINT',  N'Entero con signo de 32 bits'),
    (N'REAL',  N'Punto flotante de 32 bits');
GO


/* ============================================================================
   6. tipo_dato_com_id: FK opcional a cat.cat_tipo_dato_com, exclusivo de
      COM (regla reforzada en TR_senal_validar_clase, paso 9).
   ============================================================================ */

ALTER TABLE nucleo.senal ADD tipo_dato_com_id BIGINT NULL;
GO

ALTER TABLE nucleo.senal
    ADD CONSTRAINT FK_senal_tipo_dato_com FOREIGN KEY (tipo_dato_com_id) REFERENCES cat.cat_tipo_dato_com (id);
GO


/* ============================================================================
   7. es_loop_powered: opcional, exclusivo de CONTROL (regla reforzada en
      TR_senal_validar_clase, paso 9). No se restringe a tipo_io_id = 'AI'.
   ============================================================================ */

ALTER TABLE nucleo.senal ADD es_loop_powered BIT NULL;
GO


/* ============================================================================
   8. CHECK de exclusividad simple entre tipo_dato_com_id y es_loop_powered
      (sin JOIN a catalogo, mismo patron que CK_senal_tipo_io_direccion_excl)
      — defensa de fila adicional, NO resuelve CONTROL/COM (eso depende de
      cat.cat_clase_senal y es responsabilidad exclusiva del trigger).
   ============================================================================ */

ALTER TABLE nucleo.senal
    ADD CONSTRAINT CK_senal_tipo_dato_com_loop_excl
        CHECK (NOT (tipo_dato_com_id IS NOT NULL AND es_loop_powered IS NOT NULL));
GO


/* ============================================================================
   9. Extender TR_senal_validar_clase (DROP + CREATE). Cuerpo identico al
      de 001_initial_schema.sql salvo EXACTAMENTE estos 3 cambios:
        a) guarda de entrada: agrega UPDATE(tipo_dato_com_id) OR
           UPDATE(es_loop_powered) para que el trigger tambien dispare
           cuando solo cambian las columnas nuevas.
        b) bloque COM-prohibido: agrega "OR i.es_loop_powered IS NOT NULL"
           a la condicion; mensaje ampliado.
        c) bloque CONTROL-prohibido: agrega "OR i.tipo_dato_com_id IS NOT
           NULL" a la condicion; mensaje ampliado.
      El tercer bloque (COM con ruta activa) queda sin ningun cambio.
   ============================================================================ */

DROP TRIGGER nucleo.TR_senal_validar_clase;
GO

CREATE TRIGGER nucleo.TR_senal_validar_clase ON nucleo.senal
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT (
        UPDATE(clase_senal_id) OR UPDATE(tipo_io_id) OR UPDATE(canal_id) OR UPDATE(direccion_com_id)
        OR UPDATE(tipo_dato_com_id) OR UPDATE(es_loop_powered)
    ) RETURN;

    IF EXISTS (
        SELECT 1 FROM inserted i
        JOIN cat.cat_clase_senal c ON c.id = i.clase_senal_id
        WHERE c.codigo = N'COM' AND (i.tipo_io_id IS NOT NULL OR i.canal_id IS NOT NULL OR i.es_loop_powered IS NOT NULL)
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51008, 'Una senal COM no puede tener tipo_io_id, canal_id ni es_loop_powered.', 1;
    END

    IF EXISTS (
        SELECT 1 FROM inserted i
        JOIN cat.cat_clase_senal c ON c.id = i.clase_senal_id
        WHERE c.codigo = N'CONTROL' AND (i.direccion_com_id IS NOT NULL OR i.tipo_dato_com_id IS NOT NULL)
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51009, 'Una senal CONTROL no puede tener direccion_com_id ni tipo_dato_com_id.', 1;
    END

    -- RONDA "integridad de estados activos" — punto 5: se agrega "i.activo = 1"
    -- para que esta prohibicion dependa UNICAMENTE del estado final de la
    -- propia fila, nunca del orden de ejecucion frente a
    -- TR_senal_desactivar_ruta (otro trigger AFTER UPDATE sobre la misma
    -- tabla). Si en la misma sentencia la senal queda activo=0 Y cambia a
    -- COM, esta regla ya no aplica (la senal se esta desactivando, no
    -- "quedando" COM con ruta activa) — sin necesitar sp_settriggerorder.
    IF EXISTS (
        SELECT 1 FROM inserted i
        JOIN cat.cat_clase_senal c ON c.id = i.clase_senal_id
        WHERE i.activo = 1
          AND c.codigo = N'COM'
          AND EXISTS (
              SELECT 1 FROM nucleo.ruta_conexion r
              WHERE r.senal_id = i.id AND r.activo = 1
          )
    )
    BEGIN
        ROLLBACK TRANSACTION;
        THROW 51013, 'No se puede clasificar como COM una senal con RUTA_CONEXION activa.', 1;
    END
END
GO


COMMIT TRANSACTION;
GO
