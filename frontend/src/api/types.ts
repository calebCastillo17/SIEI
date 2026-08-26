/**
 * Tipos que reflejan exactamente lo que devuelven hoy los endpoints del
 * backend (ver backend/src/routes/me.ts, projects.ts, instruments.ts) —
 * no son un contrato aspiracional, son lo que el código de esos archivos
 * realmente serializa.
 */

export type ProjectRole = 'ADMIN' | 'EDITOR' | 'VIEWER';

export interface ProjectPermissions {
  write: boolean;
  deactivate: boolean;
  administer: boolean;
}

/** Proyecto tal como aparece en GET /api/me (más liviano: sin name/active). */
export interface MeProjectAccess {
  id: string;
  codigo: string;
  role: ProjectRole;
  permissions: ProjectPermissions;
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    nombre: string;
    esAdminSistema: boolean;
  };
  projects: MeProjectAccess[];
}

/** Proyecto tal como aparece en GET /api/projects y GET /api/projects/:id. */
export interface Project {
  id: string;
  clientId: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  access: {
    role: ProjectRole;
    permissions: ProjectPermissions;
  };
}

export interface ProjectsResponse {
  projects: Project[];
}

export interface ProjectResponse {
  project: Project;
}

/** Instrumento tal como lo devuelve GET (lista y detalle). */
export interface Instrument {
  id: string;
  projectId: string;
  estadoPnidId: string | null;
  tagInstrumento: string;
  pnpid: string | null;
  fuentePnpid: string | null;
  descripcion: string | null;
  tipoInstrumento: string | null;
  servicio: string | null;
  sistema: string | null;
  ubicacion: string | null;
  nodo: string | null;
  fechaAgregado: string | null;
  fechaUltimaRevision: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface InstrumentsListResponse {
  projectId: string;
  instruments: Instrument[];
}

export interface InstrumentResponse {
  instrument: Instrument;
}

/**
 * POST/PATCH/DELETE de instrumentos devuelven un subconjunto de campos más
 * chico que GET (ver instruments.ts) — no se tipa como Instrument completo
 * para no fingir que trae campos que esas respuestas no incluyen. Solo se
 * usa `id`/`projectId` de la respuesta para navegar y luego se vuelve a
 * pedir el detalle completo con GET.
 */
export interface InstrumentMutationResponse {
  instrument: {
    id: string;
    projectId: string;
  };
}

/** Campos que POST/PATCH de instrumentos aceptan (ver instruments.ts). */
export interface InstrumentInput {
  tagInstrumento: string;
  pnpid: string | null;
  fuentePnpid: string | null;
  descripcion: string | null;
  tipoInstrumento: string | null;
  servicio: string | null;
  sistema: string | null;
  ubicacion: string | null;
  nodo: string | null;
}

/** Equipo tal como lo devuelve GET (ver equipment.ts). */
export interface Equipment {
  id: string;
  projectId: string;
  tagEquipo: string;
  descripcion: string | null;
  sistema: string | null;
  nodo: string | null;
  panel: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface EquipmentListResponse {
  projectId: string;
  equipment: Equipment[];
}

export interface EquipmentResponse {
  equipment: Equipment;
}

/**
 * POST/PATCH/DELETE de equipos devuelven un subconjunto más chico que GET
 * (ver equipment.ts) — igual que instrumentos, solo se usa `id` de la
 * respuesta para navegar y se vuelve a pedir el detalle con GET.
 */
export interface EquipmentMutationResponse {
  equipment: {
    id: string;
    projectId: string;
  };
}

/** Campos que POST/PATCH de equipos aceptan (ver equipment.ts). */
export interface EquipmentInput {
  tagEquipo: string;
  descripcion: string | null;
  sistema: string | null;
  nodo: string | null;
  panel: string | null;
}

/** Fila de cualquiera de los catálogos simples (ver lib/simpleCatalogRouter.ts). */
export interface CatalogItem {
  id: string;
  codigo: string;
  descripcion: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface CatalogListResponse {
  items: CatalogItem[];
}

export type SignalClassCode = 'CONTROL' | 'COM';

/** Señal tal como la devuelve GET (ver signals.ts serializeSignal). */
export interface Signal {
  id: string;
  projectId: string;
  instrumentoId: string | null;
  equipoId: string | null;
  instrumentoAgrupadorId: string | null;
  claseSenalId: string;
  claseSenalCodigo: SignalClassCode;
  tipoIoId: string | null;
  tipoIoCodigo: string | null;
  direccionComId: string | null;
  direccionComCodigo: string | null;
  tipoInterfazId: string | null;
  canalId: string | null;
  estadoRevisionId: string | null;
  prioridadAlarmaId: string | null;
  tagSenal: string;
  nombreCorto: string | null;
  descripcion: string | null;
  rangoMin: number | null;
  rangoMax: number | null;
  alarmaHh: number | null;
  alarmaH: number | null;
  alarmaL: number | null;
  alarmaLl: number | null;
  valorNormal: string | null;
  unidadIngenieria: string | null;
  retardo: string | null;
  enclavamiento: string | null;
  observacion: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SignalsListResponse {
  projectId: string;
  signals: Signal[];
}

export interface SignalResponse {
  signal: Signal;
}

/**
 * POST/PATCH/DELETE de señales devuelven formas más chicas que GET en
 * algunos casos (ver signals.ts) — igual que con instrumentos, solo se usa
 * `id` de la respuesta para navegar y se vuelve a pedir el detalle con GET.
 */
export interface SignalMutationResponse {
  signal: {
    id: string;
    projectId: string;
  };
}

/**
 * Campos que POST/PATCH de señales aceptan (ver SIGNAL_FIELDS en
 * signals.ts). instrumentoId/equipoId son XOR: exactamente uno de los dos
 * al crear (lo exige CK_senal_origen_xor en la base).
 */
export interface SignalInput {
  tagSenal: string;
  claseSenalId: string;
  instrumentoId: string | null;
  equipoId: string | null;
  instrumentoAgrupadorId: string | null;
  tipoIoId: string | null;
  direccionComId: string | null;
  tipoInterfazId: string | null;
  canalId: string | null;
  estadoRevisionId: string | null;
  prioridadAlarmaId: string | null;
  nombreCorto: string | null;
  descripcion: string | null;
  rangoMin: number | null;
  rangoMax: number | null;
  alarmaHh: number | null;
  alarmaH: number | null;
  alarmaL: number | null;
  alarmaLl: number | null;
  valorNormal: string | null;
  unidadIngenieria: string | null;
  retardo: string | null;
  enclavamiento: string | null;
  observacion: string | null;
}

/* ---- Jerarquía física de E/S: RIO -> Rack -> Slot -> Módulo -> Canal --- */

export interface Rio {
  id: string;
  projectId: string;
  tagRio: string;
  descripcion: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface RiosListResponse {
  projectId: string;
  rios: Rio[];
}

export interface RioResponse {
  rio: Rio;
}

export interface RioInput {
  tagRio: string;
  descripcion: string | null;
}

export interface Rack {
  id: string;
  projectId: string;
  rioId: string;
  numeroRack: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface RacksListResponse {
  projectId: string;
  racks: Rack[];
}

export interface Slot {
  id: string;
  projectId: string;
  rackId: string;
  numeroSlot: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SlotsListResponse {
  projectId: string;
  slots: Slot[];
}

/** Módulo instalado en un slot — trae fabricante/modelo/canalesMax ya
 * resueltos desde cat.cat_modulo_io (ver modules.ts). */
export interface PhysicalModule {
  id: string;
  projectId: string;
  slotId: string;
  catalogoModuloId: string;
  fabricante: string;
  modelo: string;
  canalesMax: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ModulesListResponse {
  projectId: string;
  modules: PhysicalModule[];
}

/** Canal — SOLO LECTURA, lo administra el trigger del módulo (ver channels.ts). */
export interface Channel {
  id: string;
  projectId: string;
  moduloId: string;
  numeroCanal: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ChannelsListResponse {
  projectId: string;
  channels: Channel[];
}

/** Fila del catálogo global cat.cat_modulo_io (ver moduleTypes.ts). */
export interface ModuleType {
  id: string;
  fabricante: string;
  modelo: string;
  tipoIoId: string;
  tipoIoCodigo: string;
  canalesMax: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface ModuleTypesListResponse {
  moduleTypes: ModuleType[];
}
