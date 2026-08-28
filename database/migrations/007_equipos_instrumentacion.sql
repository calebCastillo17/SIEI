/* =============================================================================
   007_equipos_instrumentacion.sql — SIEI
   Catálogo curado de Equipos para Instrumentación — primera versión.

   CONTEXTO / DECISIONES DE NEGOCIO (aprobadas explícitamente por el usuario):
   - "Equipos" es un universo muy amplio en ingeniería. SIEI NO modela todavía
     el universo mecánico/eléctrico completo de un proyecto — `nucleo.equipo`
     sigue siendo un catálogo CURADO A MANO de los equipos relevantes para
     entregables/señales de Instrumentación (el usuario decide cuáles
     incluir), no un reflejo automático de ningún reporte P&ID.
   - Se evaluó un campo "TAG_EQUIPO_INST" (visto en una fuente de referencia
     más rica, `02_MASTER_IO_620.xlsm` hoja EQUIPOS) que distinguía el tag
     propio de un equipo del tag de instrumentación que realmente le
     interesa a Instrumentación cuando son entidades distintas (ej. un
     variador de velocidad vs. la bomba que maneja). El usuario decidió
     EXPLÍCITAMENTE NO incluirlo en esta versión — el dataset oficial vigente
     (`reference_excel/equipos_620.xlsx`, 30 registros) no lo trae, y no se
     modela ningún campo ni relación equivalente acá.
   - `plano_pnid`: referencia de documento P&ID del equipo, mismo espíritu
     que `nucleo.instrumento.plano_pnid` pero sin ninguna relación con el
     importador P&ID — se carga a mano o por el script de carga puntual de
     este dataset, nunca por el importador.
   - `tipo_equipo_id`: catálogo (`cat.cat_tipo_equipo`), no texto libre —
     decisión explícita del usuario para poder filtrar "equipos eléctricos"
     vs. "equipos de instrumentación" más adelante sin depender de que el
     texto quede escrito siempre igual. Valores iniciales: ELECTRICO e
     INSTRUMENTACION. Ninguno de los 30 equipos del dataset inicial calificó
     como INSTRUMENTACION (son variadores, UPS, generadores, tableros,
     bombas — nada que sea un instrumento de campo propiamente dicho); todos
     se cargan como ELECTRICO. No se agregan más valores al catálogo todavía
     — el catálogo queda preparado para crecer, no se infla sin necesidad
     real hoy.
   - Opcional (NULL permitido): un equipo real puede no tener P&ID ni tipo
     asignado todavía, igual que puede no tener panel/sistema/nodo (ver
     casos reales: "Medidor multifunción", "Relé Multilin...", "Tablero de
     Sincronización" — filas con varios campos vacíos en el Excel real).

   ALCANCE
   -------
   1 catálogo nuevo (`cat.cat_tipo_equipo`, 2 filas semilla) + 2 columnas
   nuevas en `nucleo.equipo` (`plano_pnid`, `tipo_equipo_id`) + 1 FK. No se
   toca 001-006. No se agrega ningún campo/relación "TAG_EQUIPO_INST".
============================================================================= */

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO


/* ============================================================================
   0. VERIFICACIÓN DE PRECONDICIÓN

   007 depende de 001 (nucleo.equipo) y de 006 (cat.cat_tipo_entregable, para
   confirmar que la cadena de migraciones está completa hasta acá).
   ============================================================================ */

IF NOT EXISTS (
    SELECT 1
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'equipo'
)
BEGIN
    THROW 55920, 'La migracion 007 requiere que 001_initial_schema.sql se haya aplicado antes (falta nucleo.equipo).', 1;
END
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'cat' AND t.name = N'cat_tipo_entregable'
)
BEGIN
    THROW 55921, 'La migracion 007 requiere que 006_entregables_base.sql se haya aplicado antes (falta cat.cat_tipo_entregable).', 1;
END
GO


/* ============================================================================
   1. cat.cat_tipo_equipo — catálogo global (sin proyecto_id), solo lectura
      desde la API. Distingue disciplina/origen del equipo.
   ============================================================================ */

CREATE TABLE cat.cat_tipo_equipo (
    id              BIGINT IDENTITY(1,1) NOT NULL,
    codigo          NVARCHAR(20)         NOT NULL,   -- 'ELECTRICO' / 'INSTRUMENTACION'
    nombre          NVARCHAR(100)        NOT NULL,   -- 'Eléctrico' / 'Instrumentación'
    created_at      DATETIME2            NOT NULL CONSTRAINT DF_cat_tipo_equipo_created_at DEFAULT SYSUTCDATETIME(),
    updated_at      DATETIME2            NULL,
    CONSTRAINT PK_cat_tipo_equipo PRIMARY KEY (id),
    CONSTRAINT UQ_cat_tipo_equipo_codigo UNIQUE (codigo)
);
GO

INSERT INTO cat.cat_tipo_equipo (codigo, nombre) VALUES
    (N'ELECTRICO', N'Eléctrico'),
    (N'INSTRUMENTACION', N'Instrumentación');
GO


/* ============================================================================
   2. nucleo.equipo — 2 columnas nuevas
   ============================================================================ */

ALTER TABLE nucleo.equipo ADD
    plano_pnid      NVARCHAR(50) NULL,
    tipo_equipo_id  BIGINT       NULL,
    CONSTRAINT FK_equipo_tipo_equipo
        FOREIGN KEY (tipo_equipo_id) REFERENCES cat.cat_tipo_equipo (id);
GO
