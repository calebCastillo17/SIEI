import type { CriterioOrden, OrdenCampo } from '../api/types';

/** Etiquetas de los campos de orden válidos hoy — el mismo conjunto de 12
 * que backend/src/lib/ldi/order.ts CAMPOS_ORDEN_VALIDOS. Si el backend
 * agrega un campo nuevo, agregarlo acá es lo único que hace falta para
 * que OrderCriteriaEditor lo ofrezca. Separado del componente (mismo
 * motivo que instrumentFormDefaults.ts/etc.): un archivo que solo exporta
 * componentes es requisito de Fast Refresh. */
export const CAMPO_LABELS: Record<OrdenCampo, string> = {
  locacion: 'Locación',
  nodo: 'Nodo',
  instrumento_asociado: 'Instrumento Asociado',
  orden_instrumentos_asociados: 'Orden de Instrumentos Asociados',
  tag: 'Tag',
  tag_anterior: 'Tag Anterior',
  servicio: 'Servicio',
  tipo: 'Tipo',
  tecnologia: 'Tecnología',
  sistema: 'Sistema',
  equipo_asociado: 'Equipo Asociado',
  pnid: 'P&ID'
};

export const ALL_ORDEN_CAMPOS = Object.keys(CAMPO_LABELS) as OrdenCampo[];

/** Secuencia de partida acordada para este proyecto — no es una regla
 * universal de SIEI, es solo el valor inicial del formulario "Nueva
 * revisión"; el usuario puede reordenar/agregar/quitar libremente antes
 * de generar la vista previa. LOCACIÓN sigue siendo la agrupación visual
 * principal del Excel — eso lo hace el generador (ver generateExcel.ts),
 * este editor solo decide el orden de comparación.
 *
 * Pedido explícito del usuario: por defecto solo P&ID ascendente — ya no
 * arranca con Locación/Nodo/Instrumento Asociado/Tag precargados; esos
 * criterios de agrupación se agregan a mano desde este mismo editor
 * cuando hagan falta, sin quitarlos de CAMPO_LABELS (siguen disponibles
 * en "+ Agregar criterio"). */
export const DEFAULT_ORDER_CRITERIA: CriterioOrden[] = [
  { campo: 'pnid', direccion: 'ASC' }
];

export function ordenCampoLabel(campo: string): string {
  return CAMPO_LABELS[campo as OrdenCampo] ?? campo;
}
