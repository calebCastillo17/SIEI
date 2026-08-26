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
