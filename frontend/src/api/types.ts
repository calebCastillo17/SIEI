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

/**
 * Instrumento tal como lo devuelve GET (lista y detalle) — incluye las
 * columnas agregadas por la importación P&ID (ver database/migrations/
 * 004_pnid_import.sql y backend/src/routes/instruments.ts). `pnpid`,
 * `fuentePnpid` y `estadoPnidId` los administra solo el flujo de
 * importación (o acceso directo a la base): no viajan en InstrumentInput.
 */
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
  tagAnterior: string | null;
  tecnologia: string | null;
  funcionamiento: string | null;
  cuerpoInstrumento: string | null;
  conexionProceso: string | null;
  planoPnid: string | null;
  lineaPnid: string | null;
  tipoSenalPnid: string | null;
  equipoAsociadoId: string | null;
  equipoAsociadoTag: string | null;
  instrumentoAsociadoId: string | null;
  instrumentoAsociadoTag: string | null;
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

/**
 * Campos que POST/PATCH de instrumentos aceptan (ver instruments.ts).
 * `pnpid`/`fuentePnpid` NO están acá a propósito: el backend rechaza con
 * 400 si esas claves siquiera están presentes en el body — los administra
 * únicamente la importación P&ID.
 */
export interface InstrumentInput {
  tagInstrumento: string;
  descripcion: string | null;
  tipoInstrumento: string | null;
  servicio: string | null;
  sistema: string | null;
  ubicacion: string | null;
  nodo: string | null;
  tagAnterior: string | null;
  tecnologia: string | null;
  funcionamiento: string | null;
  cuerpoInstrumento: string | null;
  conexionProceso: string | null;
  planoPnid: string | null;
  lineaPnid: string | null;
  tipoSenalPnid: string | null;
  equipoAsociadoId: string | null;
  equipoAsociadoTag: string | null;
  instrumentoAsociadoId: string | null;
  instrumentoAsociadoTag: string | null;
}

/** Equipo tal como lo devuelve GET (ver equipment.ts). Catálogo curado a
 * mano — nunca se puebla automáticamente desde un reporte P&ID (migración
 * 007). `tipoEquipoCodigo`/`tipoEquipoNombre` vienen ya resueltos (join
 * contra cat.cat_tipo_equipo), igual patrón que otras entidades con un
 * catálogo referenciado. */
export interface Equipment {
  id: string;
  projectId: string;
  tagEquipo: string;
  descripcion: string | null;
  sistema: string | null;
  nodo: string | null;
  panel: string | null;
  planoPnid: string | null;
  tipoEquipoId: string | null;
  tipoEquipoCodigo: string | null;
  tipoEquipoNombre: string | null;
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
  planoPnid: string | null;
  tipoEquipoId: string | null;
}

/** cat.cat_tipo_equipo (migración 007) — catálogo global, solo lectura,
 * lista cerrada por ahora (ELECTRICO / INSTRUMENTACION). No reutiliza
 * CatalogItem: su columna de texto es `nombre`, no `descripcion`. */
export interface TipoEquipo {
  id: string;
  codigo: string;
  nombre: string;
  createdAt: string;
  updatedAt: string | null;
}

export interface TiposEquipoResponse {
  items: TipoEquipo[];
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

/** POST devuelve una forma más chica que GET: su OUTPUT INSERTED no trae
 * updated_at (ver simpleCatalogRouter.ts) — recién creado, siempre sería
 * null de todas formas, así que no se re-tipa como CatalogItem completo. */
export interface CatalogItemMutationResponse {
  item: {
    id: string;
    codigo: string;
    descripcion: string | null;
    createdAt: string;
  };
}

/** Body de POST para los 3 catálogos de dominio ABIERTO (interface-types,
 * com-types, com-media-types) — los otros 6 son de lista CERRADA, solo
 * lectura (ver lib/simpleCatalogRouter.ts). Sin PATCH/DELETE en ningún
 * caso: no hay `activo` para desactivar, y editar/borrar un código ya
 * referenciado rompería FKs existentes. */
export interface CatalogInput {
  codigo: string;
  descripcion: string | null;
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

/* ---- Comunicaciones: Switch -> Puerto -> Enlace_com ------------------- */

export interface SwitchEntity {
  id: string;
  projectId: string;
  tagSwitch: string;
  descripcion: string | null;
  marcaModelo: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SwitchesListResponse {
  projectId: string;
  switches: SwitchEntity[];
}

export interface SwitchResponse {
  switch: SwitchEntity;
}

export interface SwitchInput {
  tagSwitch: string;
  descripcion: string | null;
  marcaModelo: string | null;
}

export interface Port {
  id: string;
  projectId: string;
  switchId: string;
  numeroPuerto: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface PortsListResponse {
  projectId: string;
  ports: Port[];
}

export interface CommLink {
  id: string;
  projectId: string;
  equipoId: string | null;
  instrumentoId: string | null;
  puertoId: string;
  tipoComId: string | null;
  tipoMedioId: string | null;
  tagMedio: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface CommLinksListResponse {
  projectId: string;
  commLinks: CommLink[];
}

export interface CommLinkInput {
  equipoId: string | null;
  instrumentoId: string | null;
  puertoId: string;
  tipoComId: string | null;
  tipoMedioId: string | null;
  tagMedio: string | null;
}

/* ---- Conexionado físico: Caja/Cable/Par_conductor/Punto/Ruta ---------- */

export interface Box {
  id: string;
  projectId: string;
  tagCaja: string;
  descripcion: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface BoxesListResponse {
  projectId: string;
  boxes: Box[];
}

export interface BoxResponse {
  box: Box;
}

export interface BoxInput {
  tagCaja: string;
  descripcion: string | null;
}

export interface Cable {
  id: string;
  projectId: string;
  tagCable: string;
  tipoCable: string | null;
  capacidadConductores: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface CablesListResponse {
  projectId: string;
  cables: Cable[];
}

export interface CableResponse {
  cable: Cable;
}

export interface CableInput {
  tagCable: string;
  tipoCable: string | null;
  capacidadConductores: number;
}

export interface ConductorPair {
  id: string;
  projectId: string;
  cableId: string;
  numeroPar: number;
  /** Derivado: hay un tramo_conexion activo que lo usa. No es un campo propio. */
  inUse: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ConductorPairsListResponse {
  projectId: string;
  conductorPairs: ConductorPair[];
}

export type ConnectionPointOwnerField =
  | 'instrumentoId'
  | 'equipoId'
  | 'cajaId'
  | 'rioId'
  | 'moduloId';

export interface ConnectionPoint {
  id: string;
  projectId: string;
  instrumentoId: string | null;
  equipoId: string | null;
  cajaId: string | null;
  rioId: string | null;
  moduloId: string | null;
  regleta: string | null;
  bornera: string | null;
  borne: string | null;
  lado: string | null;
  circuito: string | null;
  hilo: string | null;
  descripcion: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ConnectionPointsListResponse {
  projectId: string;
  connectionPoints: ConnectionPoint[];
}

/** Exactamente uno de los 5 campos de dueño debe tener valor (XOR). */
export interface ConnectionPointInput {
  instrumentoId: string | null;
  equipoId: string | null;
  cajaId: string | null;
  rioId: string | null;
  moduloId: string | null;
  regleta: string | null;
  bornera: string | null;
  borne: string | null;
  lado: string | null;
  circuito: string | null;
  hilo: string | null;
  descripcion: string | null;
}

export interface RouteSegment {
  id: string;
  routeId: string;
  numeroOrden: number;
  parConductorId: string;
  puntoOrigenId: string;
  puntoDestinoId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ConnectionRoute {
  id: string;
  projectId: string;
  senalId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

/** GET /:routeId trae la ruta con sus tramos anidados (ver connectionRoutes.ts). */
export interface ConnectionRouteWithSegments extends ConnectionRoute {
  segments: RouteSegment[];
}

export interface RoutesListResponse {
  projectId: string;
  routes: ConnectionRoute[];
}

export interface RouteResponse {
  route: ConnectionRouteWithSegments;
}

/** Body de POST /routes — ver connectionRoutes.ts: un solo INSERT atómico. */
export interface RouteSegmentInput {
  parConductorId: string;
  puntoOrigenId: string;
  puntoDestinoId: string;
}

export interface RouteInput {
  senalId: string;
  segments: RouteSegmentInput[];
}

/* ---- Lazo (documento de lazo de un instrumento) ------------------------ */

export interface Loop {
  id: string;
  projectId: string;
  instrumentoId: string;
  codigoDocumento: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface LoopsListResponse {
  projectId: string;
  loops: Loop[];
}

export interface LoopResponse {
  loop: Loop;
}

export interface LoopInput {
  instrumentoId: string;
  codigoDocumento: string | null;
}

/* ---- Administración: Clientes + Proyectos ------------------------------ */

/** Fila de nucleo.cliente (ver clients.ts). Solo es_admin_sistema puede
 * crear/editar/desactivar; GET es abierto a cualquier usuario autenticado. */
export interface Client {
  id: string;
  nombre: string;
  codigoInterno: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ClientsListResponse {
  clients: Client[];
}

export interface ClientResponse {
  client: Client;
}

export interface ClientInput {
  nombre: string;
  codigoInterno: string | null;
}

/** Body de POST /api/projects (ver projects.ts) — distinto de PATCH, que
 * solo admite code/name (no se puede mover un proyecto de cliente). */
export interface ProjectCreateInput {
  clientId: string;
  code: string;
  name: string;
}

export interface ProjectUpdateInput {
  code: string;
  name: string;
}

/* ---- Administración: Usuarios (registro global) ------------------------ */

/** Fila de seguridad.usuario tal como la expone /api/users — todo el
 * router requiere es_admin_sistema, incluso GET (ver users.ts). Nunca
 * incluye esAdminSistema/authIssuer/authSubject: ese privilegio no se
 * expone ni se administra por acá (CLAUDE.md, "Security model"). */
export interface AppUser {
  id: string;
  email: string;
  nombre: string;
  esAdminSistema: boolean;
  hasSignedIn: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface UsersListResponse {
  users: AppUser[];
}

export interface UserResponse {
  user: AppUser;
}

export interface UserInput {
  email: string;
  nombre: string;
}

/* ---- Administración: Miembros de un proyecto ---------------------------- */

/** Fila de seguridad.usuario_proyecto_rol vista desde un proyecto (ver
 * members.ts). GET requiere solo 'read'; POST/PATCH/DELETE requieren
 * 'administer' (ADMIN de ESE proyecto, o es_admin_sistema). */
export interface Member {
  usuarioId: string;
  email: string;
  nombre: string;
  projectId: string;
  role: ProjectRole;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface MembersListResponse {
  projectId: string;
  members: Member[];
}

export interface MemberResponse {
  member: Member;
}

/** `nombre` solo hace falta si el email todavía no existe como usuario —
 * el backend pre-registra uno nuevo en el mismo paso (ver members.ts). */
export interface MemberInput {
  email: string;
  nombre: string | null;
  rol: ProjectRole;
}

/* ---- Importación de Instrumentos desde P&ID / Plant 3D ----------------
 * Tipos que reflejan exactamente backend/src/routes/pnidImports.ts. Dos
 * formas de "resultado" distintas y NO intercambiables: la de PREVIEW
 * (`PnidPreviewResultado`, trae `filaIndex`) y la del detalle GET
 * (`PnidDetailResultado`, trae `id`/`numeroFila`/`aplicado`/`aplicadoAt`).
 * No inventar un tipo único que las mezcle. */

export type PnidImportEstado = 'PREVISUALIZADO' | 'APLICADO' | 'DESCARTADO' | 'ERROR';

export interface PnidImportCounts {
  sinCambios: number;
  nuevos: number;
  tagModificado: number;
  datosModificados: number;
  pnpidActualizado: number;
  excluidosListado: number;
  noExisteReporte: number;
  requiereRevision: number;
}

export interface PnidPreviousImportRef {
  importacionId: string;
  fechaCarga: string;
  estado: PnidImportEstado;
}

export interface PnidImportWarnings {
  missingKnownColumns: string[];
  unknownColumns: string[];
  archivoYaImportadoAntes?: PnidPreviousImportRef;
}

/** `createdBy`/`appliedBy` son solo el ID numérico del usuario (string) —
 * el backend no expone nombre/email en esta respuesta (ver comentario en
 * PnidImportsPage). No inventar una resolución a nombre acá. */
export interface PnidImport {
  id: string;
  projectId: string;
  nombreArchivo: string;
  hashArchivo: string;
  fuente: string;
  estado: PnidImportEstado;
  totalFilas: number;
  totalListadoTrue: number;
  conteos: PnidImportCounts;
  advertencias: PnidImportWarnings;
  fechaCarga: string;
  fechaAplicacion: string | null;
  createdBy: string | null;
  appliedBy: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface PnidFieldDiff {
  campo: string;
  anterior: string | null;
  nuevo: string | null;
}

/** Para REQUIERE_REVISION/TAG_DUPLICADO/TAG_VACIO el backend manda una
 * explicación en prosa en vez de un arreglo de diffs por campo. */
export type PnidDiferencias = PnidFieldDiff[] | { detalle: string } | null;

/** Todos los campos mapeados de la fila fuente (no solo los que cambiaron
 * respecto al instrumento existente) — claves = PnidField (ver
 * pnidLabels.ts). null si no hay fila fuente (NO_EXISTE_EN_PNID). */
export type PnidDatosPropuestos = Record<string, string | null> | null;

/** Forma de cada resultado dentro de la respuesta de POST /preview. */
export interface PnidPreviewResultado {
  filaIndex: number | null;
  pnpid: string | null;
  tagInstrumento: string | null;
  instrumentoId: string | null;
  resultado: string;
  diferencias: PnidDiferencias;
  requiereRevision: boolean;
  datosPropuestos: PnidDatosPropuestos;
}

/** Forma de cada resultado dentro de GET /:importId (detalle). */
export interface PnidDetailResultado {
  id: string;
  importacionId: string;
  filaId: string | null;
  numeroFila: number | null;
  pnpid: string | null;
  tagInstrumento: string | null;
  instrumentoId: string | null;
  resultado: string;
  diferencias: PnidDiferencias;
  requiereRevision: boolean;
  aplicado: boolean;
  aplicadoAt: string | null;
  datosPropuestos: PnidDatosPropuestos;
}

export interface PnidImportsListResponse {
  projectId: string;
  imports: PnidImport[];
}

export interface PnidPreviewResponse {
  import: PnidImport;
  resultados: PnidPreviewResultado[];
}

export interface PnidImportDetailResponse {
  import: PnidImport;
  resultados: PnidDetailResultado[];
}

/** POST /:importId/apply devuelve una forma angosta (sin conteos) — hay
 * que volver a pedir el detalle con GET para ver el resumen posterior. */
export interface PnidApplyResponse {
  import: {
    id: string;
    projectId: string;
    estado: PnidImportEstado;
  };
}

export interface PnidDiscardResponse {
  import: {
    id: string;
    projectId: string;
    estado: PnidImportEstado;
  };
}

/*
 * Entregables / LDI (migración 006) — reflejan exactamente lo que
 * serializan backend/src/routes/{documentacion,plantillasEntregable,
 * entregables,revisionesEntregable,tiposEntregable}.ts.
 */

export interface TipoEntregable {
  id: string;
  codigo: string;
  descripcion: string;
  disciplina: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface TiposEntregableResponse {
  items: TipoEntregable[];
}

/** nucleo.proyecto_documentacion — 1:1 con el proyecto, metadatos de
 * carátula. Todo NULL si el proyecto todavía no cargó nada (ver GET). */
export interface ProyectoDocumentacion {
  projectId: string;
  codigoProyectoCumbra: string | null;
  codigoProyectoCliente: string | null;
  tituloCaratula: string | null;
  etapaCodigo: string | null;
  etapaNombre: string | null;
  afe: string | null;
  vp: string | null;
  jefeDisciplina: string | null;
  liderProyecto: string | null;
  gerenteIngenieriaConstruccion: string | null;
  inicialesPorDefault: string | null;
  inicialesRevisadoDefault: string | null;
  inicialesAprobadoDefault: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DocumentacionResponse {
  documentacion: ProyectoDocumentacion;
}

export type DocumentacionInput = Partial<
  Omit<ProyectoDocumentacion, 'projectId' | 'createdAt' | 'updatedAt'>
>;

export interface PlantillaEntregable {
  id: string;
  projectId: string;
  tipoEntregableId: string;
  nombreArchivo: string;
  archivoHash: string;
  tamanioBytes: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
}

export interface PlantillasListResponse {
  projectId: string;
  plantillas: PlantillaEntregable[];
}

export interface PlantillaMutationResponse {
  plantilla: PlantillaEntregable;
}

/** Los mismos 11 campos válidos que backend/src/lib/ldi/order.ts
 * CAMPOS_ORDEN_VALIDOS — si el backend agrega uno nuevo, agregarlo acá y
 * a CAMPO_LABELS en OrderCriteriaEditor.tsx es lo único que hace falta. */
export type OrdenCampo =
  | 'sistema'
  | 'nodo'
  | 'tag'
  | 'tag_anterior'
  | 'servicio'
  | 'tipo'
  | 'tecnologia'
  | 'locacion'
  | 'equipo_asociado'
  | 'instrumento_asociado'
  | 'orden_instrumentos_asociados';

export interface CriterioOrden {
  campo: OrdenCampo;
  direccion: 'ASC' | 'DESC';
}

export interface Entregable {
  id: string;
  projectId: string;
  tipoEntregableId: string;
  numeroDocumento: string;
  componenteEtapa: string | null;
  componenteProyecto: string | null;
  componenteCliente: string | null;
  componenteTipo: string | null;
  componenteArea: string | null;
  componenteDisciplina: string | null;
  componenteCorrelativo: string | null;
  titulo: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface EntregablesListResponse {
  projectId: string;
  entregables: Entregable[];
}

export interface EntregableResponse {
  entregable: Entregable;
}

export interface EntregableInput {
  tipoEntregableId: string;
  componenteArea?: string | null;
  componenteDisciplina?: string | null;
  componenteCorrelativo: string;
  titulo?: string | null;
}

export type RevisionEstado = 'BORRADOR' | 'EMITIDA' | 'DESCARTADA';

export interface RevisionEntregable {
  id: string;
  projectId: string;
  entregableId: string;
  codigoRevision: string;
  fecha: string;
  descripcion: string;
  inicialesPor: string;
  inicialesRevisado: string;
  inicialesAprobado: string;
  estado: RevisionEstado;
  configuracionOrdenId: string | null;
  criteriosAplicados: CriterioOrden[] | null;
  plantillaId: string | null;
  archivoId: string | null;
  emitidaBy: string | null;
  emitidaAt: string | null;
  descartadaBy: string | null;
  descartadaAt: string | null;
  /** Fila fija (32-36) de la carátula, asignada una sola vez al emitir y
   * nunca recalculada después (migración 010) — `null` si nunca se emitió
   * o si ya fue expulsada de la ventana de 5 revisiones visibles. */
  filaCaratula: number | null;
  createdAt: string;
  updatedAt: string | null;
  createdBy: string | null;
}

export interface RevisionesListResponse {
  projectId: string;
  entregableId: string;
  revisiones: RevisionEntregable[];
}

/** Las 19 columnas del LDI ya resueltas — ver backend/src/lib/ldi/
 * snapshot.ts. Genérico a propósito en el backend (JSON), tipado acá solo
 * para este entregable. */
export interface LdiSnapshotRow {
  tag: string;
  descripcion: string;
  tipo: string;
  tecnologia: string;
  conexionProceso: string;
  linea: string;
  equipoAsociado: string;
  servicio: string;
  locacion: string;
  sistema: string;
  hojaDeDatos: string;
  pnid: string;
  diagramaDeLazo: string;
  planoDeUbicacion: string;
  marcaModelo: string;
  comentarios: string;
  nodo: string;
  rev: string;
}

export interface RevisionFila {
  item: number;
  instrumentoId?: string;
  snapshot: LdiSnapshotRow;
}

export interface RevisionCaratulaHistorial {
  codigoRevision: string;
  fecha: string;
  descripcion: string;
  inicialesPor: string;
  inicialesRevisado: string;
  inicialesAprobado: string;
}

export interface MetadatosSnapshot {
  proyectoCumbra: string | null;
  proyectoCliente: string | null;
  titulo: string | null;
  etapaCodigo: string | null;
  etapaNombre: string | null;
  afe: string | null;
  vp: string | null;
  jefeDisciplina: string | null;
  liderProyecto: string | null;
  gerenteIngenieriaConstruccion: string | null;
  numeroDocumento: string;
  revisionesMostradasEnCaratula?: RevisionCaratulaHistorial[];
}

export interface RevisionDetailResponse {
  revision: RevisionEntregable;
  metadatosSnapshot: MetadatosSnapshot | null;
  filas: RevisionFila[];
}

/** Forma común de POST (crear BORRADOR) y PATCH (editar/regenerar
 * preview) — ambos devuelven el preview persistido completo. */
export interface RevisionMutationResponse {
  revision: RevisionEntregable;
  metadatosSnapshot: MetadatosSnapshot;
  totalFilas: number;
  filas: RevisionFila[];
}

export interface RevisionEmitirResponse {
  revision: RevisionEntregable;
  archivo: {
    id: string;
    nombreArchivo: string;
    archivoHash: string;
    tamanioBytes: number;
  };
}

export interface RevisionCreateInput {
  codigoRevision: string;
  fecha?: string;
  descripcion: string;
  inicialesPor?: string;
  inicialesRevisado?: string;
  inicialesAprobado?: string;
  criterios?: CriterioOrden[];
  configuracionOrdenId?: string;
}

export type RevisionUpdateInput = Partial<RevisionCreateInput>;

/** DELETE .../revisiones/:id sobre una EMITIDA/DESCARTADA con
 * `eliminarDefinitivamente: true` (migración 009) — borrado físico real,
 * nunca vuelve a existir. */
export interface RevisionEliminacionResponse {
  eliminado: true;
  revisionId: string;
  estadoAnterior: RevisionEstado;
}
