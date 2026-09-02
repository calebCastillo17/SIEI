/* =============================================================================
   016_senal_dueno_ausente.sql — SIEI
   Permite que una señal quede sin dueño (ni instrumento_id ni equipo_id)
   EXCLUSIVAMENTE cuando eso ocurre porque su instrumento fue eliminado
   definitivamente — nunca como estado por defecto ni alcanzable por accidente.

   CONTEXTO / DECISION DE NEGOCIO (aprobada explícitamente por el usuario,
   sesión de trabajo sobre la sección CONTROL — "Opción A: solo señal, sin
   tocar punto_conexion/ruta"):

   - Hallazgo que motivó esto: `DELETE .../instruments/:id` con
     `eliminarDefinitivamente: true` (migración 011) rechaza la eliminación
     (409 instrument_in_use) si CUALQUIER nucleo.senal activa referencia al
     instrumento — ni una sola señal queda nunca "flotando" hoy, la
     eliminación simplemente no ocurre. El usuario pidió lo contrario para
     el caso de un instrumento que de verdad desapareció (p. ej. tras una
     reimportación P&ID): que la eliminación proceda, la señal se conserve
     activa, y quede marcada de forma explícita como "sin dueño" en vez de
     simplemente desaparecer la referencia sin dejar rastro.

   - CK_senal_origen_xor (001_initial_schema.sql) exige HOY exactamente uno
     de instrumento_id/equipo_id — no hay forma de representar "ninguno de
     los dos" sin tocar ese CHECK. Se agrega dueno_ausente (BIT NOT NULL
     DEFAULT 0) precisamente para que ese estado sea SIEMPRE explícito y
     nunca accidental: con dueno_ausente = 0 (el default de toda señal
     nueva, sin cambio de comportamiento) la regla de "exactamente un
     dueño" sigue exactamente igual que desde 001; con dueno_ausente = 1 se
     exige lo contrario — CERO dueños. Es estructuralmente imposible llegar
     a instrumento_id/equipo_id ambos NULL sin poner dueno_ausente = 1 al
     mismo tiempo, en la misma sentencia.

   - Alcance deliberadamente acotado a nucleo.senal ("Opción A"): NO se
     toca nucleo.punto_conexion ni su propio CK_punto_conexion_pertenencia_xor
     ni su FK_punto_conexion_instrumento. Eso significa que si el
     instrumento es además el ORIGEN FÍSICO de una ruta activa (es decir,
     hay un punto_conexion propio apuntándolo, no solo la señal), el
     `DELETE FROM nucleo.instrumento` sigue fallando por esa llave foránea
     — la verificación de uso ya existente en instruments.ts para
     punto_conexion/lazo/enlace_com NO cambia. dueno_ausente solo puede
     llegar a manifestarse en la práctica para señales SIN ruta activa (o
     cuya ruta no tiene a este instrumento como origen). Una "Opción B"
     (extender el mismo mecanismo a punto_conexion) quedó evaluada y
     explícitamente diferida — no se modela acá.

   - No se toca ningún trigger: se revisó exhaustivamente
     TR_senal_validar_clase, TR_senal_validar_canal_ruta,
     TR_senal_desactivar_ruta y TR_ruta_conexion_validar_clase_senal — ninguno
     asume que instrumento_id/equipo_id esté poblado, y el punto (c) de
     TR_senal_validar_canal_ruta ("cambio de dueño con ruta activa") ya
     resulta vacuously true (no lanza) cuando el nuevo dueño es NULL en
     ambos lados, porque sus dos condiciones exigen explícitamente
     "IS NOT NULL" del lado nuevo antes de comparar. Confirmado por lectura
     completa antes de escribir esta migración, no asumido.

   - dueno_ausente se establece EXCLUSIVAMENTE desde el backend, en la
     misma transacción que hace `DELETE FROM nucleo.instrumento` (ver
     backend/src/routes/instruments.ts) — nunca a través de POST/PATCH
     normales de nucleo.senal (mismo criterio que pnpid/fuente_pnpid en
     nucleo.instrumento: administrado por un único flujo, no por el CRUD
     genérico).
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
    SELECT 1 FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'terminacion'
)
BEGIN
    THROW 55992, 'La migracion 016 requiere que 001-015 se hayan aplicado antes (falta nucleo.terminacion).', 1;
END
GO

IF EXISTS (
    SELECT 1 FROM sys.columns c
    JOIN sys.tables t ON t.object_id = c.object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'senal' AND c.name = N'dueno_ausente'
)
BEGIN
    THROW 55993, 'La migracion 016 ya fue aplicada (nucleo.senal.dueno_ausente ya existe).', 1;
END
GO


BEGIN TRANSACTION;


/* ============================================================================
   1. nucleo.senal.dueno_ausente — DEFAULT 0 permanente (a diferencia de
      gabinete.tipo_gabinete_id en 012, acá SÍ tiene sentido un default
      universal: toda señal nueva sigue exigiendo exactamente un dueño real,
      igual que siempre; dueno_ausente=1 es un estado que solo alcanza una
      señal YA EXISTENTE, nunca el punto de partida de una nueva).
   ============================================================================ */

ALTER TABLE nucleo.senal
    ADD dueno_ausente BIT NOT NULL CONSTRAINT DF_senal_dueno_ausente DEFAULT 0;
GO


/* ============================================================================
   2. Reemplazar CK_senal_origen_xor (DROP + CREATE, mismo nombre) para que
      "cero dueños" sea válido unicamente cuando dueno_ausente = 1 — la
      regla original ("exactamente un dueño") se preserva intacta para
      dueno_ausente = 0, que sigue siendo el valor de toda fila existente y
      de toda fila nueva por defecto.
   ============================================================================ */

ALTER TABLE nucleo.senal DROP CONSTRAINT CK_senal_origen_xor;
GO

ALTER TABLE nucleo.senal
    ADD CONSTRAINT CK_senal_origen_xor CHECK (
        (CASE WHEN instrumento_id IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN equipo_id IS NULL THEN 0 ELSE 1 END)
        =
        CASE WHEN dueno_ausente = 1 THEN 0 ELSE 1 END
    );
GO


COMMIT TRANSACTION;
GO
