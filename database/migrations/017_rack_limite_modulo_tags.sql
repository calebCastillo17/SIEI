/* =============================================================================
   017_rack_limite_modulo_tags.sql — SIEI
   Tres columnas nuevas, sin relación estructural entre sí más que "todas
   nacieron del mismo pedido del usuario sobre el flujo de armado físico de
   un gabinete de Control": límite de slots por rack, y dos tags opcionales
   por módulo (el tag propio del módulo y el del surge protector).

   CONTEXTO / DECISIÓN DE NEGOCIO (aprobada explícitamente por el usuario):

   - nucleo.rack.limite_slots (SMALLINT NULL): tope de slots que ese rack
     físico acepta. Nullable y sin DEFAULT — los racks ya existentes (todos
     fixtures de prueba, sin dato real de límite) quedan sin límite en vez
     de inventarles uno; un rack nuevo puede fijarlo o dejarlo sin límite.
     Se valida en el backend (POST /slots), no acá con un trigger/CHECK,
     porque requiere leer el conteo de slots activos del rack en el momento
     de crear uno nuevo — el mismo criterio que ya usa el resto de SIEI
     para reglas que necesitan un conteo, no solo la fila misma.

   - nucleo.modulo.tag (NVARCHAR(20) NULL): la etiqueta visible del módulo
     (ej. "DI-03"). El usuario la edita libremente; el backend solo la
     PRE-LLENA con una sugerencia (tipo_io + posición entre los del mismo
     tipo en el rack, contando en orden de slot y saltando los módulos que
     no tienen tag puesto todavía) — la sugerencia vive en el backend
     (modules.ts), no en una columna calculada ni en un trigger, porque es
     apenas un punto de partida editable, nunca una regla que deba
     recalcularse sola cuando cambian otros módulos.

   - nucleo.modulo.surge_protector_tag (NVARCHAR(20) NULL): igual que el
     tag del módulo, pero para el protector de sobretensión OPCIONAL de
     ese módulo (ej. "DISPR-02") — NULL significa "este módulo no lleva
     surge protector", no "todavía no se le puso nombre". Se evaluó una
     tabla aparte (mismo patrón que bloque_terminal) y se descartó: es un
     solo dato opcional por módulo, sin sub-atributos ni ciclo de vida
     propio — una tabla nueva sería sobre-ingeniería para esto.

     El tag del Terminal Block de cada módulo NO es parte de esta
     migración — ya existe (`nucleo.bloque_terminal.codigo`, desde la 015)
     y ya es editable vía PATCH /bloques-terminal/:id; el valor "MODULO"
     que trae por defecto (TR_modulo_generar_terminales) sigue siendo el
     mismo centinela de "todavía sin tag real" que ya usaba, la sugerencia
     de "TB-02" etc. también vive del lado del backend/frontend, igual que
     el tag del módulo.

   Todas NULLABLE, todas sin DEFAULT forzado, todas puramente descriptivas
   — ninguna participa en ningún CHECK, FK, ni trigger existente.
   ============================================================================= */

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;


/* ============================================================================
   1. nucleo.rack.limite_slots
   ============================================================================ */

ALTER TABLE nucleo.rack
    ADD limite_slots SMALLINT NULL;
GO

ALTER TABLE nucleo.rack
    ADD CONSTRAINT CK_rack_limite_slots_positivo CHECK (limite_slots IS NULL OR limite_slots > 0);
GO


/* ============================================================================
   2. nucleo.modulo.tag / nucleo.modulo.surge_protector_tag
   ============================================================================ */

ALTER TABLE nucleo.modulo
    ADD tag NVARCHAR(20) NULL;
GO

ALTER TABLE nucleo.modulo
    ADD surge_protector_tag NVARCHAR(20) NULL;
GO


COMMIT TRANSACTION;
GO
