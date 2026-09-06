-- =============================================================================
-- Migracion 042: nucleo.c_cuerpo_valvula.posicion_montaje (20 -> 50)
-- =============================================================================
-- Encontrado al cargar los datos reales del Excel "DB HD.xlsx": el valor
-- real de Valvulas Hidraulicas/Neumaticas es "Horizontal / Vertical" (21
-- caracteres), mas largo que el limite original de 20 (basado en el
-- valor de un solo caso real visto antes, "Horizontal", que resulto no
-- ser representativo de toda la familia). Se ensancha con margen (50)
-- para no repetir el mismo problema con otra variante de texto.
-- =============================================================================

SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;
GO

ALTER TABLE nucleo.c_cuerpo_valvula
    ALTER COLUMN posicion_montaje NVARCHAR(50) NULL;
GO
