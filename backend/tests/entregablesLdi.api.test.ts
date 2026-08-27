/*
 * Pruebas de API para el módulo de Entregables — Listado de Instrumentos
 * (LDI), migración 006.
 *
 * Corre TODO en un proyecto temporal propio (nunca TEST-001): importa el
 * reporte P&ID real para tener instrumentos reales, sube la plantilla
 * oficial vigente (reference_excel/Lista_instrumentos_plantilla.xlsx —
 * reemplaza a la anterior "Listado_formato_Macros - PLANTILLA 1.xlsm",
 * que queda intacta en el repo sin usarse más para generación), arma el
 * entregable LDI de CUMBRA con los datos confirmados, y ejercita el ciclo
 * completo BORRADOR -> DESCARTADA / BORRADOR -> EMITIDA (inmutable).
 *
 * Además de verificar aserciones, este script GUARDA en disco:
 *   - la Rev A emitida (el archivo real, exacto, para revisión visual)
 *   - la última revisión emitida (para verificar el carrusel de 5 en carátula)
 *
 * Uso: npm run test:entregables-ldi
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const BASE = 'http://localhost:3000';
const ADMIN = 'admin@siei.local';

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    pass++;
    console.log(`PASS: ${label}`);
  } else {
    fail++;
    console.log(`FAIL: ${label}` + (extra ? ` -- ${JSON.stringify(extra)}` : ''));
  }
}

async function call(method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': ADMIN },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* sin body JSON */ }
  return { status: res.status, json };
}

async function uploadPlantilla(
  projectId: string,
  buffer: Buffer,
  filename: string,
  tipoEntregableId: string
): Promise<{ status: number; json: any }> {
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  form.append('tipoEntregableId', tipoEntregableId);
  const res = await fetch(`${BASE}/api/projects/${projectId}/plantillas-entregable`, {
    method: 'POST',
    headers: { 'X-Dev-User-Email': ADMIN },
    body: form
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* sin body JSON */ }
  return { status: res.status, json };
}

async function uploadPnidPreview(projectId: string, buffer: Buffer, filename: string) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  const res = await fetch(`${BASE}/api/projects/${projectId}/pnid-imports/preview`, {
    method: 'POST',
    headers: { 'X-Dev-User-Email': ADMIN },
    body: form
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* sin body JSON */ }
  return { status: res.status, json };
}

async function downloadArchivo(projectId: string, entregableId: string, revisionId: string) {
  const res = await fetch(`${BASE}/api/projects/${projectId}/entregables/${entregableId}/revisiones/${revisionId}/archivo`, {
    headers: { 'X-Dev-User-Email': ADMIN }
  });
  const buffer = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buffer, headerHash: res.headers.get('x-archivo-sha256'), contentType: res.headers.get('content-type') };
}

// LOCACIÓN reemplazó a SISTEMA como criterio de mayor jerarquía (y como
// campo que genera las secciones visuales del LDI, ver generateExcel.ts)
// — decisión de esta ronda de correcciones, no una regla universal de
// SIEI (otros entregables/proyectos pueden usar otra secuencia).
const CRITERIOS_ESTANDAR = [
  { campo: 'locacion', direccion: 'ASC' },
  { campo: 'nodo', direccion: 'ASC' },
  { campo: 'instrumento_asociado', direccion: 'ASC' },
  { campo: 'orden_instrumentos_asociados', direccion: 'ASC' },
  { campo: 'tag', direccion: 'ASC' }
];

const runId = Date.now().toString(36);
let projectId: string | undefined;

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, '../..');
  const templatePath = path.resolve(repoRoot, 'reference_excel/Lista_instrumentos_plantilla.xlsx');
  const pnidReportPath = path.resolve(repoRoot, 'reference_excel/162281-620-Instrument List.xlsx');
  const outDir = path.resolve(repoRoot, 'backend/tmp-ldi-output');
  await mkdir(outDir, { recursive: true });

  // ==================== SETUP: proyecto temporal ====================
  const clientsResp = await call('GET', '/api/clients');
  const clientId = clientsResp.json?.clients?.[0]?.id;
  check('Hay al menos un cliente para el proyecto temporal', Boolean(clientId));

  const createProject = await call('POST', '/api/projects', {
    clientId,
    code: `TEST-LDI-${runId}`,
    name: 'Proyecto temporal — Entregables LDI'
  });
  check('Proyecto temporal creado (201)', createProject.status === 201, createProject.json);
  projectId = createProject.json?.project?.id;
  if (!projectId) throw new Error('No se pudo crear el proyecto temporal.');

  const DOC = `/api/projects/${projectId}/documentacion`;
  const PLANTILLAS = `/api/projects/${projectId}/plantillas-entregable`;
  const ENTREGABLES = `/api/projects/${projectId}/entregables`;
  const INSTRUMENTS = `/api/projects/${projectId}/instruments`;

  // ==================== proyecto_documentacion (datos CUMBRA) ====================
  const docPatch = await call('PATCH', DOC, {
    codigoProyectoCumbra: '22043',
    codigoProyectoCliente: '4620003347',
    tituloCaratula: 'TAILING PUMPING SYSTEM IX Y \nPOZA DE CONTINGENCIA',
    etapaCodigo: '104',
    etapaNombre: 'INGENIERÍA DE DETALLE',
    afe: '22043',
    vp: 'Portafolio de Proyectos',
    jefeDisciplina: 'AUGUSTO INCISO',
    liderProyecto: 'J. TORDOYA / E. REYNAGA',
    gerenteIngenieriaConstruccion: 'OSCAR ASCENSION',
    inicialesPorDefault: 'D.S.T.',
    inicialesRevisadoDefault: 'A.R.Q.',
    inicialesAprobadoDefault: 'L.L.C.'
  });
  check('PATCH proyecto_documentacion (200)', docPatch.status === 200, docPatch.json);
  check('documentacion.codigoProyectoCumbra = 22043', docPatch.json?.documentacion?.codigoProyectoCumbra === '22043');

  const docGet = await call('GET', DOC);
  check('GET documentacion refleja lo guardado', docGet.json?.documentacion?.afe === '22043');

  // ==================== catálogos ====================
  const tipos = await call('GET', '/api/catalogs/tipos-entregable');
  check('GET tipos-entregable trae LDI', tipos.json?.items?.some((t: any) => t.codigo === 'LDI'), tipos.json);
  const tipoLdi = tipos.json.items.find((t: any) => t.codigo === 'LDI');
  check('LDI tiene disciplina conceptual "Instrumentación", no la letra "J"', tipoLdi?.disciplina === 'Instrumentación');

  const ordenTipo = await call('GET', '/api/catalogs/orden-tipo-instrumento');
  check('GET orden-tipo-instrumento trae 20 prefijos (preset legacy)', ordenTipo.json?.items?.length === 20, ordenTipo.json?.items?.length);

  // ==================== instrumentos reales (import P&ID) ====================
  const reportBuffer = await readFile(pnidReportPath).catch(() => null);
  if (!reportBuffer) {
    console.warn(`No se encontró el reporte real en ${pnidReportPath} — se aborta.`);
    process.exit(1);
  }
  const preview = await uploadPnidPreview(projectId, reportBuffer, 'reporte-real.xlsx');
  check('Preview P&ID del reporte real (201)', preview.status === 201, preview.json);
  const applyResp = await call('POST', `/api/projects/${projectId}/pnid-imports/${preview.json.import.id}/apply`);
  check('Apply P&ID (200)', applyResp.status === 200, applyResp.json);

  const instrumentsAfterImport = await call('GET', INSTRUMENTS);
  const totalInstrumentos = instrumentsAfterImport.json?.instruments?.length ?? 0;
  check(`Instrumentos reales activos tras el import: ${totalInstrumentos} (se esperaban ~352)`, totalInstrumentos > 300 && totalInstrumentos < 400);

  // Asociación EXPLÍCITA entre dos instrumentos reales, para probar que la
  // relación instrumento_asociado_id pesa más que la agrupación inferida.
  const instrumentos = instrumentsAfterImport.json.instruments as any[];
  const instA = instrumentos.find((i) => i.tagInstrumento === '620-LIT-5013');
  const instB = instrumentos.find((i) => i.tagInstrumento === '620-LI-5014');
  check('Encontrados los 2 instrumentos reales para probar asociación explícita', Boolean(instA && instB), { instA: instA?.id, instB: instB?.id });

  if (instA && instB) {
    const patchAsoc = await call('PATCH', `${INSTRUMENTS}/${instB.id}`, { instrumentoAsociadoId: instA.id });
    check('PATCH instrumentoAsociadoId (relación explícita para el test de orden)', patchAsoc.status === 200, patchAsoc.json);
  }

  // ==================== plantilla: subir y REEMPLAZAR (2 veces) ====================
  const templateBuffer = await readFile(templatePath).catch(() => null);
  if (!templateBuffer) {
    console.warn(`No se encontró la plantilla real en ${templatePath} — se aborta.`);
    process.exit(1);
  }

  const p1 = await uploadPlantilla(projectId, templateBuffer, 'PLANTILLA-P1.xlsx', tipoLdi.id);
  check('Subida de plantilla P1 (201)', p1.status === 201, p1.json);
  const p1Id = p1.json?.plantilla?.id;

  const p2 = await uploadPlantilla(projectId, templateBuffer, 'PLANTILLA-P2.xlsx', tipoLdi.id);
  check('Reemplazo de plantilla -> P2 (201)', p2.status === 201, p2.json);
  const p2Id = p2.json?.plantilla?.id;

  const plantillasList = await call('GET', PLANTILLAS);
  const p1Row = plantillasList.json.plantillas.find((p: any) => p.id === p1Id);
  const p2Row = plantillasList.json.plantillas.find((p: any) => p.id === p2Id);
  check('P1 quedó activo=false tras el reemplazo', p1Row?.active === false, p1Row);
  check('P2 quedó activo=true (la vigente)', p2Row?.active === true, p2Row);
  check('El hash de P1 no cambió (nunca se edita in-place)', p1Row?.archivoHash === p1.json.plantilla.archivoHash);

  // ==================== configuración de orden reutilizable ====================
  const configOrden = await call('POST', `/api/projects/${projectId}/configuraciones-orden`, {
    nombre: 'Orden estándar Instrumentación CUMBRA',
    tipoEntregableId: tipoLdi.id,
    esDefault: true,
    criterios: CRITERIOS_ESTANDAR
  });
  check('POST configuracion-orden default (201)', configOrden.status === 201, configOrden.json);

  // ==================== entregable LDI ====================
  const entregable = await call('POST', ENTREGABLES, {
    tipoEntregableId: tipoLdi.id,
    componenteArea: '620',
    componenteDisciplina: 'J',
    componenteCorrelativo: '0001'
  });
  check('POST entregable LDI (201)', entregable.status === 201, entregable.json);
  const entregableId = entregable.json?.entregable?.id;
  const numeroEsperado = '104-22043-4620003347-LDI-620-J-0001';
  check(
    `numero_documento correcto: ${entregable.json?.entregable?.numeroDocumento}`,
    entregable.json?.entregable?.numeroDocumento === numeroEsperado
  );

  const REVISIONES = `/api/projects/${projectId}/entregables/${entregableId}/revisiones`;

  // ==================== BORRADOR descartado ====================
  const draft1 = await call('POST', REVISIONES, {
    codigoRevision: 'A',
    descripcion: 'Borrador de prueba, se va a descartar'
  });
  check('POST revision BORRADOR (201)', draft1.status === 201, draft1.json);
  check('BORRADOR usa la config default sin pedirla explícitamente', draft1.json?.revision?.criteriosAplicados?.length === CRITERIOS_ESTANDAR.length);
  const draft1Id = draft1.json?.revision?.id;

  const discard1 = await call('DELETE', `${REVISIONES}/${draft1Id}`);
  check('DELETE (descartar) BORRADOR -> DESCARTADA (200)', discard1.status === 200 && discard1.json?.revision?.estado === 'DESCARTADA', discard1.json);

  const discard1Again = await call('DELETE', `${REVISIONES}/${draft1Id}`);
  check('Descartar de nuevo una ya DESCARTADA -> 409', discard1Again.status === 409, discard1Again.json);

  const patchDescartada = await call('PATCH', `${REVISIONES}/${draft1Id}`, { descripcion: 'intento' });
  check('PATCH sobre una DESCARTADA -> 409 (no editable)', patchDescartada.status === 409, patchDescartada.json);

  // ==================== agrupación por instrumento asociado, aislada ====================
  // sistema/nodo pesan más que instrumento_asociado en el orden estándar —
  // instA/instB pueden tener sistema/nodo reales distintos, así que para
  // verificar la agrupación en sí misma (no el orden final de Rev A) se
  // arma un BORRADOR descartable con SOLO instrumento_asociado + tag como
  // criterios, sin sistema/nodo por delante.
  if (instA && instB) {
    const draftGrouping = await call('POST', REVISIONES, {
      codigoRevision: 'ZZGROUP',
      descripcion: 'Solo para verificar agrupación por instrumento asociado — se descarta',
      criterios: [
        { campo: 'instrumento_asociado', direccion: 'ASC' },
        { campo: 'tag', direccion: 'ASC' }
      ]
    });
    check('BORRADOR aislado para probar agrupación (201)', draftGrouping.status === 201, draftGrouping.json);
    const filasGrouping: any[] = draftGrouping.json?.filas ?? [];
    const idxA2 = filasGrouping.findIndex((f) => f.snapshot.tag === instA.tagInstrumento);
    const idxB2 = filasGrouping.findIndex((f) => f.snapshot.tag === instB.tagInstrumento);
    check(
      `Con instrumento_asociado como criterio dominante: ${instB.tagInstrumento} (idx ${idxB2}) queda adyacente a ${instA.tagInstrumento} (idx ${idxA2})`,
      idxA2 >= 0 && idxB2 >= 0 && Math.abs(idxA2 - idxB2) === 1,
      { idxA2, idxB2 }
    );
    await call('DELETE', `${REVISIONES}/${draftGrouping.json.revision.id}`);
  }

  // ==================== BORRADOR real -> preview -> EMITIDA (Rev A) ====================
  const draft2 = await call('POST', REVISIONES, {
    codigoRevision: 'A',
    fecha: '2026-05-12',
    descripcion: 'Emitido para revisión interna'
  });
  check('POST segundo BORRADOR "A" tras descartar el primero (201)', draft2.status === 201, draft2.json);
  const revAId = draft2.json?.revision?.id;
  check('BORRADOR usa iniciales default de proyecto_documentacion', draft2.json?.revision?.inicialesPor === 'D.S.T.' && draft2.json?.revision?.inicialesRevisado === 'A.R.Q.' && draft2.json?.revision?.inicialesAprobado === 'L.L.C.');
  check(`totalFilas del preview: ${draft2.json?.totalFilas} (=~ instrumentos activos)`, draft2.json?.totalFilas === totalInstrumentos);

  const filas: any[] = draft2.json.filas;
  check('ITEM es consecutivo 1..N tras ordenar', filas.every((f, idx) => f.item === idx + 1));
  check('REV en cada fila del snapshot = "A"', filas.every((f) => f.snapshot.rev === 'A'));
  check(
    'Campos sin fuente están vacíos ("") en TODAS las filas, no ausentes',
    filas.every((f) =>
      f.snapshot.hojaDeDatos === '' &&
      f.snapshot.diagramaDeLazo === '' &&
      f.snapshot.planoDeUbicacion === '' &&
      f.snapshot.marcaModelo === '' &&
      f.snapshot.comentarios === ''
    )
  );

  check('El snapshot SÍ incluye "sistema" (restaurada, columna propia de la plantilla oficial vigente)', filas.every((f) => 'sistema' in f.snapshot));
  check('Al menos una fila tiene "sistema" no vacío (dato real, no solo la clave presente)', filas.some((f) => f.snapshot.sistema));
  check('El snapshot ya NO incluye "tagAnterior" (la plantilla oficial vigente eliminó esa columna)', filas.every((f) => !('tagAnterior' in f.snapshot)));

  // (La agrupación por instrumento asociado en sí misma ya se verificó más
  // arriba, aislada de locación/nodo — ver el BORRADOR "ZZGROUP". Con el
  // orden ESTÁNDAR, locación/nodo pesan más, así que instA/instB no
  // necesariamente terminan adyacentes acá si tienen locación/nodo reales
  // distintos — eso es correcto, no un bug.)

  // Verifica orden ASC por LOCACIÓN como criterio de más alto nivel (la
  // API solo expone el orden lineal; la agrupación visual en secciones y
  // el reinicio de ITEM por locación se verifican sobre el .xlsx físico).
  // Los instrumentos SIN locación van siempre al final (pedido explícito
  // del usuario) — no entran en el ordenamiento alfabético con los demás.
  const locaciones = filas.map((f) => f.snapshot.locacion || '');
  const conLocacion = locaciones.filter((l) => l !== '');
  const conLocacionOrdenadas = [...conLocacion].sort((a, b) => a.localeCompare(b, 'es'));
  check(
    'Los instrumentos CON locación quedan ordenados ascendentemente entre sí',
    JSON.stringify(conLocacion) === JSON.stringify(conLocacionOrdenadas)
  );
  const primerIndiceSinLocacion = locaciones.indexOf('');
  const ultimoIndiceConLocacion = locaciones.reduce((max, l, idx) => (l !== '' ? idx : max), -1);
  check(
    'Los instrumentos SIN locación quedan todos después de los que sí tienen',
    primerIndiceSinLocacion === -1 || primerIndiceSinLocacion > ultimoIndiceConLocacion
  );

  // PATCH sobre el BORRADOR: editar descripción y regenerar.
  const patchDraft2 = await call('PATCH', `${REVISIONES}/${revAId}`, { descripcion: 'Emitido para revisión interna (editado)' });
  check('PATCH BORRADOR edita y regenera el preview (200)', patchDraft2.status === 200 && patchDraft2.json?.revision?.descripcion.includes('editado'));

  const emitirA = await call('POST', `${REVISIONES}/${revAId}/emitir`);
  check('POST emitir -> EMITIDA (200)', emitirA.status === 200 && emitirA.json?.revision?.estado === 'EMITIDA', emitirA.json);
  const archivoAInfo = emitirA.json.archivo;

  // Inmutabilidad de EMITIDA, verificada vía API (no solo trigger SQL).
  const patchEmitida = await call('PATCH', `${REVISIONES}/${revAId}`, { descripcion: 'no debería poder' });
  check('PATCH sobre una EMITIDA -> 409', patchEmitida.status === 409, patchEmitida.json);
  const discardEmitida = await call('DELETE', `${REVISIONES}/${revAId}`);
  check('DELETE (descartar) sobre una EMITIDA -> 409', discardEmitida.status === 409, discardEmitida.json);
  const emitirDeNuevo = await call('POST', `${REVISIONES}/${revAId}/emitir`);
  check('Emitir de nuevo una ya EMITIDA -> 409', emitirDeNuevo.status === 409, emitirDeNuevo.json);

  // Descarga real: el binario debe coincidir con el hash emitido.
  const descargaA = await downloadArchivo(projectId, entregableId, revAId);
  const hashLocal = createHash('sha256').update(descargaA.buffer).digest('hex');
  check('GET archivo descarga 200', descargaA.status === 200);
  check('SHA-256 del archivo descargado = SHA-256 emitido', hashLocal === archivoAInfo.archivoHash, { hashLocal, emitido: archivoAInfo.archivoHash });
  check('Header X-Archivo-Sha256 también coincide', descargaA.headerHash === archivoAInfo.archivoHash);
  check('Content-Type es el de un .xlsx', descargaA.contentType?.includes('spreadsheetml'));

  const revAPath = path.join(outDir, '104-22043-4620003347-LDI-620-J-0001_RevA.xlsx');
  await writeFile(revAPath, descargaA.buffer);
  console.log(`\nRev A guardada en: ${revAPath} (${descargaA.buffer.length} bytes, sha256=${hashLocal})\n`);

  // ==================== más revisiones: probar el carrusel de 5 en carátula ====================
  const codigosSiguientes = ['B', 'C', 'D', '0', '1'];
  let ultimaRevisionId: string | undefined;
  for (const codigo of codigosSiguientes) {
    const d = await call('POST', REVISIONES, { codigoRevision: codigo, descripcion: `Emitido — prueba carrusel ${codigo}` });
    check(`BORRADOR "${codigo}" creado (201)`, d.status === 201, d.json);
    const rid = d.json?.revision?.id;
    const e = await call('POST', `${REVISIONES}/${rid}/emitir`);
    check(`Revisión "${codigo}" emitida (200)`, e.status === 200, e.json);
    ultimaRevisionId = rid;
  }

  const historial = await call('GET', REVISIONES);
  const emitidas = historial.json.revisiones.filter((r: any) => r.estado === 'EMITIDA');
  check(`Historial tiene ${emitidas.length} revisiones EMITIDA (A,B,C,D,0,1 = 6)`, emitidas.length === 6);

  if (ultimaRevisionId) {
    const descargaUltima = await downloadArchivo(projectId, entregableId, ultimaRevisionId);
    const ultimaPath = path.join(outDir, '104-22043-4620003347-LDI-620-J-0001_Rev1.xlsx');
    await writeFile(ultimaPath, descargaUltima.buffer);
    console.log(`Última revisión (Rev 1, para ver el carrusel de 5) guardada en: ${ultimaPath}`);
  }

  // ==================== permisos ====================
  const viewerCreate = await fetch(`${BASE}${REVISIONES}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': 'viewer@siei.local' },
    body: JSON.stringify({ codigoRevision: 'X', descripcion: 'no debería poder' })
  });
  check('VIEWER sin acceso al proyecto temporal -> 403', viewerCreate.status === 403);

  console.log(`\n${pass} PASS / ${fail} FAIL`);
}

main()
  .catch((error) => {
    console.error('Error inesperado en la suite:', error);
    fail++;
  })
  .finally(async () => {
    if (projectId) {
      const archive = await call('DELETE', `/api/projects/${projectId}`);
      console.log(`Proyecto temporal ${projectId} archivado: status ${archive.status}`);
    }
    console.log(`\nTOTAL: ${pass} PASS / ${fail} FAIL`);
    process.exit(fail > 0 ? 1 : 0);
  });
