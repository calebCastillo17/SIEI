/* =============================================================================
   011_revision_fila_instrumento_opcional.sql — SIEI
   revision_entregable_fila.instrumento_id pasa a ser opcional, con
   ON DELETE SET NULL — para que un instrumento pueda eliminarse
   definitivamente del Master sin que una revisión ya EMITIDA lo retenga
   para siempre.

   CONTEXTO / DECISIÓN DE NEGOCIO (aprobada explícitamente por el usuario):
   - El usuario pidió eliminar definitivamente instrumentos con estado
     P&ID = NO_EXISTE_EN_PNID. Todos los que tiene hoy en un proyecto real
     ya están congelados dentro de una revisión LDI EMITIDA (Rev A del
     entregable 10035) — la FK original (`instrumento_id BIGINT NOT NULL`,
     sin acción de borrado) rechaza el DELETE del instrumento mientras esa
     fila exista, con error de violación de FK.
   - Al preguntarle si había que borrar la revisión completa primero, el
     usuario objetó correctamente el diseño de fondo: "si ya cree un
     entregable ese entregable no debe estar aun amarrado a nada, yo puedo
     eliminarlo normal". Verificado: `revision_entregable_fila.datos_snapshot`
     (NVARCHAR(MAX), JSON) ya es un snapshot autocontenido — es lo único
     que usa `generateExcel.ts` y el detalle de la revisión para
     reconstruir/mostrar una revisión emitida. `instrumento_id` es
     puramente un enlace de vuelta al Master, no forma parte del
     documento histórico en sí, y ni el backend ni el frontend lo leen
     hoy para nada al renderizar una revisión ya emitida.
   - Conclusión: la FK estaba retenida por un motivo que no correspondía
     a la filosofía ya documentada de "REVISIÓN = snapshot histórico
     congelado" (ver CLAUDE.md, sección Entregables/LDI). Este cambio la
     alinea: la fila histórica sobrevive siempre, con su contenido
     intacto; solo pierde el enlace en vivo hacia un Master que evolucionó
     (incluido un borrado definitivo del instrumento).
   - NO se usa `ON DELETE SET NULL` nativo: es una FK compuesta
     `(instrumento_id, proyecto_id)`, y SQL Server exige que TODAS las
     columnas de una FK compuesta sean nullable para poder usar `SET
     NULL` (nulearía también `proyecto_id`, que nunca puede ser NULL en
     ninguna tabla de `nucleo` — es la base del aislamiento
     multiproyecto). Confirmado en la práctica: SQL Server rechaza la FK
     con error 1761 si se intenta. En su lugar, el propio endpoint de
     borrado definitivo de instrumentos (backend) hace
     `UPDATE ... SET instrumento_id = NULL` explícito antes del `DELETE`
     del instrumento, dentro de la misma transacción — mismo resultado,
     sin depender de una acción de FK que este motor no permite acá.
   - Esa actualización explícita, sobre una fila que pertenece a una
     revisión ya EMITIDA, sigue necesitando el mismo bypass de
     SESSION_CONTEXT de la migración 009
     (`siei_bypass_inmutabilidad_revision`) — el endpoint lo arma antes
     del UPDATE/DELETE y lo apaga antes del COMMIT, igual que el de
     revisiones.

   ALCANCE
   -------
   Solo nucleo.revision_entregable_fila: columna, FK y el índice único
   que la incluye (una restricción UNIQUE normal en SQL Server solo
   admite una fila con NULL — con varios instrumentos eliminados de la
   misma revisión, hacía falta un índice único FILTRADO en su lugar,
   mismo patrón que el resto del modelo usa para unicidad + borrado
   lógico). No se toca 001-010.
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
   ============================================================================ */

IF NOT EXISTS (
    SELECT 1
    FROM sys.columns c
    JOIN sys.tables t ON t.object_id = c.object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE s.name = N'nucleo' AND t.name = N'revision_entregable_fila' AND c.name = N'instrumento_id'
)
BEGIN
    THROW 55960, 'La migracion 011 requiere que 006_entregables_base.sql se haya aplicado antes (falta nucleo.revision_entregable_fila.instrumento_id).', 1;
END
GO


/* ============================================================================
   1. QUITAR LA UNIQUE CONSTRAINT ORIGINAL (no admite mas de un NULL)
   ============================================================================ */

ALTER TABLE nucleo.revision_entregable_fila
    DROP CONSTRAINT UQ_revision_entregable_fila_instrumento;
GO


/* ============================================================================
   2. QUITAR LA FK ORIGINAL (sin accion de borrado)
   ============================================================================ */

ALTER TABLE nucleo.revision_entregable_fila
    DROP CONSTRAINT FK_revision_entregable_fila_instrumento;
GO


/* ============================================================================
   3. VOLVER LA COLUMNA OPCIONAL
   ============================================================================ */

ALTER TABLE nucleo.revision_entregable_fila
    ALTER COLUMN instrumento_id BIGINT NULL;
GO


/* ============================================================================
   4. RECREAR LA FK (sin accion de borrado nativa — ver nota de cabecera:
      SQL Server no permite ON DELETE SET NULL en una FK compuesta cuyo
      otro miembro, proyecto_id, es NOT NULL). El backend hace el SET
      NULL a mano antes de borrar el instrumento.
   ============================================================================ */

ALTER TABLE nucleo.revision_entregable_fila
    ADD CONSTRAINT FK_revision_entregable_fila_instrumento
        FOREIGN KEY (instrumento_id, proyecto_id)
        REFERENCES nucleo.instrumento (id, proyecto_id);
GO


/* ============================================================================
   5. INDICE UNICO FILTRADO (reemplaza a la UNIQUE constraint de 006)
   ============================================================================ */

CREATE UNIQUE INDEX UX_revision_entregable_fila_instrumento
    ON nucleo.revision_entregable_fila (revision_id, instrumento_id)
    WHERE instrumento_id IS NOT NULL;
GO
