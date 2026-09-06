-- =============================================================================
-- Migracion 037: nucleo.c_envolvente.tipo_montaje
-- =============================================================================
-- Octava migracion del modulo Hojas de Datos (HD). Familia Valvulas
-- Hidraulicas — confirmado con la hoja real Instrumentos_ValvHidraulicas
-- que reutiliza EXACTAMENTE las mismas tablas ya construidas para
-- Valvulas Neumaticas (c_cuerpo_valvula, c_actuador,
-- c_interruptor_posicion, c_envolvente vía "CAJA DE CONEXIONES") — pago
-- directo de la unificacion que la propia usuaria ya habia hecho en su
-- hoja _T_VALVULA. No se crea ninguna tabla nueva.
--
-- Unico campo real faltante: "CAJA DE CONEXIONES — Tipo de montaje"
-- (valor real: "Remoto") no tenia columna en c_envolvente — las cajas de
-- Valvulas Neumaticas no mostraban este dato, pero la caja de conexiones
-- de Hidraulicas si lo trae. Evolucion aditiva simple, mismo criterio ya
-- usado en todo el proyecto.
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

ALTER TABLE nucleo.c_envolvente
    ADD tipo_montaje NVARCHAR(30) NULL;
GO
