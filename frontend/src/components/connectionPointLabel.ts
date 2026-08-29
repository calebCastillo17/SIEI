import type { Box, ConnectionPoint, Equipment, Gabinete, Instrument, PhysicalModule } from '../api/types';

interface OwnerLists {
  instruments: Instrument[];
  equipment: Equipment[];
  boxes: Box[];
  gabinetes: Gabinete[];
  modules: PhysicalModule[];
}

/** Etiqueta legible de a quién pertenece un punto de conexión — usado tanto
 * en la lista de puntos de conexión como en el armador de rutas. */
export function connectionPointOwnerLabel(point: ConnectionPoint, options: OwnerLists): string {
  if (point.instrumentoId) {
    const item = options.instruments.find((i) => i.id === point.instrumentoId);
    return `Instrumento ${item?.tagInstrumento ?? `#${point.instrumentoId}`}`;
  }
  if (point.equipoId) {
    const item = options.equipment.find((e) => e.id === point.equipoId);
    return `Equipo ${item?.tagEquipo ?? `#${point.equipoId}`}`;
  }
  if (point.cajaId) {
    const item = options.boxes.find((b) => b.id === point.cajaId);
    return `Caja ${item?.tagCaja ?? `#${point.cajaId}`}`;
  }
  if (point.gabineteId) {
    const item = options.gabinetes.find((g) => g.id === point.gabineteId);
    return `Gabinete ${item?.tagGabinete ?? `#${point.gabineteId}`}`;
  }
  if (point.moduloId) {
    const item = options.modules.find((m) => m.id === point.moduloId);
    return `Módulo ${item ? `${item.fabricante} ${item.modelo}` : `#${point.moduloId}`}`;
  }
  return '—';
}

/** Etiqueta legible de un punto de conexión completo: dueño + ubicación. */
export function connectionPointFullLabel(point: ConnectionPoint, options: OwnerLists): string {
  const location = [point.regleta, point.bornera, point.borne]
    .filter((part): part is string => !!part)
    .join('/');
  return location
    ? `${connectionPointOwnerLabel(point, options)} (${location})`
    : connectionPointOwnerLabel(point, options);
}
