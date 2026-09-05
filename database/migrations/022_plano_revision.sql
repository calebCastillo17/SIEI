/* =============================================================================
   022_plano_revision.sql — SIEI
   Agrega nucleo.plano.revision (NVARCHAR(10) NULL) — pedido explícito del
   usuario, campo libre para la letra de revisión del documento (ej. "B"),
   independiente de activo/inactivo (que ya cubre "vigente vs. anulado").

   Sin DEFAULT permanente (los planos futuros no necesariamente arrancan en
   "B" — es solo el valor real de todos los planos existentes hoy en el
   proyecto 22043/620, confirmado por el usuario). Se backfillea acá mismo
   para las filas ya existentes al aplicar la migración.

   `disciplina` (Electricidad si el código tiene "E" entre guiones,
   Instrumentación si tiene "J") NO es una columna — el usuario pidió una
   regla simple derivada de codigo_plano, que puede cambiar de valor si el
   código se edita; se calcula en el backend (planos.ts) para no arriesgar
   que quede desincronizada.
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

ALTER TABLE nucleo.plano
    ADD revision NVARCHAR(10) NULL;
GO

UPDATE nucleo.plano
SET revision = N'B'
WHERE revision IS NULL;
GO

COMMIT TRANSACTION;
GO
