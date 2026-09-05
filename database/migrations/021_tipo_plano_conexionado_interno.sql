/* =============================================================================
   021_tipo_plano_conexionado_interno.sql — SIEI
   Renombra cat.cat_tipo_plano 'INTERIOR_GABINETE' -> 'CONEXIONADO_INTERNO'
   (pedido explícito del usuario) — mismo id, mismo criterio que la 012
   (gabinete/rio): renombre en el lugar, nunca borrar+recrear, para que los
   3 planos reales del proyecto 22043/620 que ya usan este tipo (620-J-20017,
   620-J-20023, 620-J-20013 — lo referencian por tipo_plano_id, no por
   texto) sigan apuntando exactamente al mismo tipo sin ningún cambio de
   datos aparte del texto.
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

UPDATE cat.cat_tipo_plano
SET codigo = N'CONEXIONADO_INTERNO',
    descripcion = N'Conexionado interno de un gabinete',
    updated_at = SYSUTCDATETIME()
WHERE codigo = N'INTERIOR_GABINETE';

COMMIT TRANSACTION;
GO
