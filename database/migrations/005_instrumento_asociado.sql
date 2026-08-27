/* =============================================================================
   005_instrumento_asociado.sql — SIEI
   Vínculo INSTRUMENTO -> INSTRUMENTO ("Instrumento Asociado" en el reporte
   P&ID / Plant 3D), aprobado por el usuario como columna nueva en el
   reporte real después de aplicar 004_pnid_import.sql.

   DECISIÓN DE NEGOCIO (aprobada explícitamente por el usuario):
   - "Instrumento Asociado" es un vínculo entre dos instrumentos: el
     instrumento que trae el dato "contiene" al otro instrumento asociado.
     Es una relación EXPLÍCITA nueva, distinta de `equipo_asociado_*`
     (que vincula con nucleo.equipo) y de `senal.instrumento_agrupador_id`
     (que vincula una SEÑAL con un instrumento agrupador, no un instrumento
     con otro instrumento).
   - Se modela EXACTAMENTE igual que `equipo_asociado_id`/`equipo_asociado_tag`
     (ver 004_pnid_import.sql): un id resuelto (auto-referencia a
     nucleo.instrumento) + un tag de texto libre, ambos editables por
     separado, sin sincronización automática entre los dos fuera del import.
   - Participa en la comparación P&ID igual que `equipo_asociado_tag`: si
     cambia, el resultado es DATOS_MODIFICADOS (agregado a DIFFABLE_FIELDS
     vía headers.ts, no requiere cambios de esquema en cat.cat_estado_pnid).
   - Un instrumento no puede asociarse a sí mismo — es una regla de
     integridad de datos (una fila que se "contiene" a sí misma no es un
     estado válido), no una regla de negocio nueva; se refuerza con un
     CHECK a nivel de base además de la validación en el backend.

   ALCANCE
   -------
   Solo ADD de 2 columnas + 1 FK + 1 CHECK + 1 índice filtrado en
   nucleo.instrumento. No se toca 001-004.
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

   005 depende de 004 (nucleo.instrumento.equipo_asociado_id/_tag como
   precedente directo del mismo patrón de modelado).
   ============================================================================ */

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns c
    JOIN sys.tables t ON t.object_id = c.object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'instrumento' AND c.name = N'equipo_asociado_id'
)
BEGIN
    THROW 55910,
    'La migracion 005 requiere que 004_pnid_import.sql se haya aplicado antes (falta nucleo.instrumento.equipo_asociado_id).',
    1;
END
GO


/* ============================================================================
   1. NUEVAS COLUMNAS EN nucleo.instrumento
   ============================================================================ */

ALTER TABLE nucleo.instrumento ADD
    instrumento_asociado_id   BIGINT        NULL,
    instrumento_asociado_tag  NVARCHAR(50)  NULL,
    CONSTRAINT FK_instrumento_instrumento_asociado
        FOREIGN KEY (instrumento_asociado_id, proyecto_id)
        REFERENCES nucleo.instrumento (id, proyecto_id),
    CONSTRAINT CK_instrumento_asociado_no_self
        CHECK (instrumento_asociado_id IS NULL OR instrumento_asociado_id <> id);
GO

CREATE INDEX IX_instrumento_instrumento_asociado
    ON nucleo.instrumento (instrumento_asociado_id)
    WHERE instrumento_asociado_id IS NOT NULL;
GO
