/*
 * Carga los datos REALES del Excel "DB HD.xlsx" de la usuaria (proyecto
 * 620 / 50050) al módulo Hojas de Datos, vía la API real (nunca SQL
 * directo — mismo criterio que el resto de scripts de carga de esta
 * sesión).
 *
 * Alcance de esta PRIMERA pasada (deliberadamente NO 100% del Excel,
 * para no bloquear todo por las partes más complejas):
 *   - cat.cat_requisito: sembrado con los 15 códigos reales que la
 *     propia usuaria ya identificó en su hoja _T_REQUISITO.
 *   - Documentos (9), Sitio (1), Tuberia (~40).
 *   - Notas (122) — solo el TEXTO de cada nota por documento.
 *   - Las 9 hojas Instrumentos_<Tipo>: 1 ficha_tecnica_instrumento +
 *     todos sus componentes reales + requisitos (via el mapeo de
 *     sufijos de columna -> codigo REQ) + marcas aceptables (fabricante
 *     multi-marca separado por "/").
 *   - Tags (87): matchea cada tag real contra nucleo.instrumento YA
 *     existente (cargado por P&ID) — si existe, lo actualiza con
 *     ficha_tecnica_id/sitio_id/tuberia_id y crea la asociación
 *     instrumento_documento. Si el tag NO existe todavía en la base
 *     (algunos tags de válvulas no estaban en el P&ID importado), se
 *     omite con una advertencia — este script NUNCA crea instrumentos
 *     nuevos, esa es responsabilidad exclusiva del importador P&ID.
 *
 * DELIBERADAMENTE FUERA de esta pasada (documentado, no un olvido):
 *   - TAG_PROCESO (columnas O:AM de Tags) — el rango de columnas varia
 *     por tipo de documento y necesita su propio mapeo cuidadoso,
 *     mejor como pasada separada.
 *   - Tag_Notas (1116 filas) — la relación individual nota<->tag, mejor
 *     como pasada separada dado el volumen.
 *
 * Uso:
 *   npx tsx scripts/importHojasDeDatos620.ts --project 50050 --dry-run
 *   npx tsx scripts/importHojasDeDatos620.ts --project 50050 --apply
 */

import ExcelJS from 'exceljs';
import path from 'node:path';

interface Args {
  projectId: string;
  apiBase: string;
  devUserEmail: string;
  mode: 'dry-run' | 'apply';
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const has = (flag: string) => args.includes(flag);
  const projectId = get('--project');
  if (!projectId) {
    console.error('Falta --project <projectId>.');
    process.exit(1);
  }
  const dryRun = has('--dry-run');
  const apply = has('--apply');
  if (dryRun === apply) {
    console.error('Especificá exactamente uno de --dry-run / --apply.');
    process.exit(1);
  }
  return {
    projectId,
    apiBase: get('--api') ?? 'http://localhost:3000',
    devUserEmail: get('--user') ?? 'admin@siei.local',
    mode: dryRun ? 'dry-run' : 'apply'
  };
}

async function apiFetch<T = any>(
  apiBase: string, devUserEmail: string, urlPath: string,
  init: { method?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(`${apiBase}${urlPath}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User-Email': devUserEmail },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${urlPath} -> ${response.status}: ${JSON.stringify(json)}`);
  }
  return json as T;
}

/* ---- helpers de lectura de Excel ------------------------------------- */

function sheetHeaders(ws: ExcelJS.Worksheet): string[] {
  // OJO: row.values de exceljs puede ser un array "sparse" — Array.map
  // SALTA huecos y deja `undefined` en vez de aplicar el callback, por
  // eso se llena con un for explícito (nunca .map) en vez de asumir que
  // todos los índices existen.
  const raw = ws.getRow(1).values as any[];
  const result: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    result[i] = v === undefined || v === null ? '' : String(v).trim();
  }
  return result;
}

function sheetRows(ws: ExcelJS.Worksheet): any[][] {
  const rows: any[][] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.values && (row.values as any[]).some((v) => v !== undefined && v !== null && String(v).trim() !== '')) {
      rows.push(row.values as any[]);
    }
  }
  return rows;
}

/** Índice EXACTO de una columna por su texto de encabezado (col 1 = A, values[] arranca en 1). */
function colIndex(headers: string[], text: string): number {
  const idx = headers.findIndex((h) => h === text);
  if (idx < 0) throw new Error(`No se encontró la columna "${text}". Encabezados: ${headers.filter(Boolean).join(' | ')}`);
  return idx;
}
function colIndexOpt(headers: string[], text: string): number | null {
  const idx = headers.findIndex((h) => h === text);
  return idx < 0 ? null : idx;
}

function cell(row: any[], idx: number | null): string | null {
  if (idx === null) return null;
  const v = row[idx];
  if (v === undefined || v === null) return null;
  const s = typeof v === 'object' && 'result' in v ? String((v as any).result ?? '') : String(v);
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** null-safe: convierte "N.A."/"-"/"VTS" (VTS SI se conserva, es un valor real de "a definir por vendor") a null solo para N.A./"-". */
function cleanTechValue(v: string | null): string | null {
  if (v === null) return null;
  if (v === 'N.A.' || v === '-' || v === 'n.a.') return null;
  return v;
}

function parseFirstNumber(v: string | null): number | null {
  if (v === null) return null;
  const m = v.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/* ---- REQUISITO: mapeo de sufijo de columna -> codigo REQ (cerrado, ya
 * identificado por la propia usuaria en su hoja _T_REQUISITO) ---------- */

const REQUISITO_POR_SUFIJO: Record<string, string> = {
  'FAT test': 'REQ-FAT',
  'SAT test': 'REQ-SAT',
  'Placa de identificación': 'REQ-PLACA',
  'Repuestos': 'REQ-REPUESTOS',
  'Certificado de calibración': 'REQ-CALIB',
  'Calibración / Configuración': 'REQ-CALIB',
  'Kit de montaje': 'REQ-KITMONT',
  'Kit de montaje del transmisor': 'REQ-KITMONT',
  'Capacitaciones': 'REQ-CAPAC',
  'Capacitación': 'REQ-CAPAC',
  'Capacitaciones op. y mantenimiento': 'REQ-CAPAC',
  'Capacitaciones de operación y mantenimiento': 'REQ-CAPAC',
  'Soporte puesta en servicio': 'REQ-SOPPS',
  'Soporte para puesta en servicio': 'REQ-SOPPS',
  'Soporte técnico': 'REQ-SOPPS',
  'Asistencia técnica': 'REQ-SOPPS',
  'Accesorios de puesta a tierra': 'REQ-PATIERRA',
  'Brackets fijación fuente radioactiva': 'REQ-BRACKET',
  'Brackets fijación detector/transmisor': 'REQ-BRACKET',
  'Licencias': 'REQ-LICENCIA',
  'Certificaciones regulatorias': 'REQ-CERTREG',
  'Soporte integral registro IPEN': 'REQ-IPEN',
  'Transporte y entrega': 'REQ-TRANSP',
  'Instalación, puesta en servicio': 'REQ-INSTAL'
};

const REQUISITOS_SEED: Array<{ codigo: string; descripcion: string; categoria: string }> = [
  { codigo: 'REQ-FAT', descripcion: 'Prueba FAT en fábrica', categoria: 'Prueba' },
  { codigo: 'REQ-SAT', descripcion: 'Prueba SAT en sitio', categoria: 'Prueba' },
  { codigo: 'REQ-PLACA', descripcion: 'Placa de identificación', categoria: 'Suministro' },
  { codigo: 'REQ-REPUESTOS', descripcion: 'Repuestos', categoria: 'Suministro' },
  { codigo: 'REQ-CALIB', descripcion: 'Certificado de calibración', categoria: 'Documento' },
  { codigo: 'REQ-KITMONT', descripcion: 'Kit de montaje', categoria: 'Suministro' },
  { codigo: 'REQ-CAPAC', descripcion: 'Capacitación de operación y mantenimiento', categoria: 'Servicio' },
  { codigo: 'REQ-SOPPS', descripcion: 'Soporte para puesta en servicio', categoria: 'Servicio' },
  { codigo: 'REQ-PATIERRA', descripcion: 'Accesorios de puesta a tierra', categoria: 'Suministro' },
  { codigo: 'REQ-BRACKET', descripcion: 'Brackets de fijación', categoria: 'Suministro' },
  { codigo: 'REQ-LICENCIA', descripcion: 'Licencias', categoria: 'Regulatorio' },
  { codigo: 'REQ-CERTREG', descripcion: 'Certificaciones regulatorias', categoria: 'Regulatorio' },
  { codigo: 'REQ-IPEN', descripcion: 'Soporte integral registro IPEN', categoria: 'Regulatorio' },
  { codigo: 'REQ-TRANSP', descripcion: 'Transporte y entrega', categoria: 'Servicio' },
  { codigo: 'REQ-INSTAL', descripcion: 'Instalación y puesta en servicio', categoria: 'Servicio' }
];

function valorRequisito(raw: string | null): { valor: string; detalle: string | null } | null {
  if (raw === null) return null;
  if (raw === 'N.A.' || raw === '-') return { valor: 'NO_APLICA', detalle: null };
  if (raw.toUpperCase().startsWith('REQUERIDO')) {
    const resto = raw.slice('Requerido'.length).trim();
    const detalle = resto.length > 0 ? resto.replace(/^\(|\)$/g, '') : null;
    return { valor: 'REQUERIDO', detalle };
  }
  // Cualquier otro texto no vacío (ej. las 2 filas reales de REQ-BRACKET,
  // que en el Excel real vienen como "Requerido" tambien) se trata como
  // REQUERIDO con el texto completo de detalle.
  return { valor: 'REQUERIDO', detalle: raw };
}

/** "Ashcroft / Wika (Nota 6)" -> ["Ashcroft", "Wika"] */
function splitFabricantes(raw: string | null): string[] {
  if (raw === null) return [];
  const sinNotas = raw.replace(/\(Nota[s]?[^)]*\)/gi, '');
  return sinNotas.split('/').map((s) => s.trim()).filter((s) => s.length > 0 && s.toUpperCase() !== 'VTS');
}

/* ---- main ------------------------------------------------------------ */

async function main() {
  const { projectId, apiBase, devUserEmail, mode } = parseArgs();
  const isDryRun = mode === 'dry-run';
  const excelPath = path.join(process.cwd(), '..', 'reference_excel', 'DB HD.xlsx');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);

  const stats = { documentos: 0, sitios: 0, tuberias: 0, notas: 0, fichas: 0, componentes: 0, requisitos: 0, marcas: 0, tagsMatcheados: 0, tagsSinMatch: 0 };
  const marcaCache = new Map<string, string>(); // codigo -> fabricanteId
  const requisitoCache = new Map<string, string>(); // codigo -> requisitoId

  async function ensureFabricante(nombre: string): Promise<string> {
    const codigo = nombre.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 30);
    if (marcaCache.has(codigo)) return marcaCache.get(codigo)!;
    if (isDryRun) { marcaCache.set(codigo, `dry-${codigo}`); return `dry-${codigo}`; }
    try {
      const { item } = await apiFetch<{ item: { id: string } }>(apiBase, devUserEmail, '/api/catalogs/fabricantes', { method: 'POST', body: { codigo, descripcion: nombre } });
      marcaCache.set(codigo, item.id);
      return item.id;
    } catch (err) {
      // Ya existe -> buscarlo.
      const { items } = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/fabricantes');
      const found = items.find((i) => i.codigo === codigo);
      if (!found) throw err;
      marcaCache.set(codigo, found.id);
      return found.id;
    }
  }

  // --- 0) cat.cat_requisito (seed idempotente) ---
  console.log('\n=== 0) cat.cat_requisito ===');
  const { items: requisitosExistentes } = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/requisitos');
  for (const r of requisitosExistentes) requisitoCache.set(r.codigo, r.id);
  for (const seed of REQUISITOS_SEED) {
    if (requisitoCache.has(seed.codigo)) continue;
    console.log(`  + ${seed.codigo}`);
    if (!isDryRun) {
      const { item } = await apiFetch<{ item: { id: string } }>(apiBase, devUserEmail, '/api/catalogs/requisitos', { method: 'POST', body: seed });
      requisitoCache.set(seed.codigo, item.id);
    } else {
      requisitoCache.set(seed.codigo, `dry-${seed.codigo}`);
    }
  }

  // --- 0b) cat.cat_tipo_documento (HOJA_DE_DATOS) ---
  const { items: tiposDoc } = await apiFetch<{ items: Array<{ id: string; codigo: string }> }>(apiBase, devUserEmail, '/api/catalogs/tipos-documento');
  let tipoHdId = tiposDoc.find((t) => t.codigo === 'HOJA_DE_DATOS')?.id;
  if (!tipoHdId) {
    console.log('  + cat_tipo_documento HOJA_DE_DATOS');
    if (!isDryRun) {
      const { item } = await apiFetch<{ item: { id: string } }>(apiBase, devUserEmail, '/api/catalogs/tipos-documento', { method: 'POST', body: { codigo: 'HOJA_DE_DATOS', descripcion: 'Hoja de datos de instrumento' } });
      tipoHdId = item.id;
    } else {
      tipoHdId = 'dry-tipo-hd';
    }
  }

  // --- 1) Documentos ---
  console.log('\n=== 1) Documentos ===');
  const wsDoc = workbook.getWorksheet('Documentos')!;
  const hDoc = sheetHeaders(wsDoc);
  const documentoIdPorCodigo = new Map<string, string>(); // "DOC-01" -> id real
  const iDocId = colIndex(hDoc, 'documento_id');
  const iDocCodigo = colIndex(hDoc, 'codigo_hd');
  const iDocTitulo = colIndex(hDoc, 'titulo');
  for (const row of sheetRows(wsDoc)) {
    const docCode = cell(row, iDocId)!;
    const codigoHd = cell(row, iDocCodigo);
    const titulo = cell(row, iDocTitulo)!;
    console.log(`  ${docCode}: ${titulo}`);
    if (!isDryRun) {
      const { documento } = await apiFetch<{ documento: { id: string } }>(apiBase, devUserEmail, `/api/projects/${projectId}/documentos`, {
        method: 'POST', body: { codigoDocumento: codigoHd, descripcion: titulo, tipoDocumentoId: tipoHdId }
      });
      documentoIdPorCodigo.set(docCode, documento.id);
    } else {
      documentoIdPorCodigo.set(docCode, `dry-${docCode}`);
    }
    stats.documentos++;
  }

  // --- 2) Sitio ---
  console.log('\n=== 2) Sitio ===');
  const wsSitio = workbook.getWorksheet('Sitio')!;
  const hSitio = sheetHeaders(wsSitio);
  const sitioRow = sheetRows(wsSitio)[0];
  let sitioIdReal: string | null = null;
  if (sitioRow) {
    const body = {
      altitudMsnm: parseFirstNumber(cell(sitioRow, colIndex(hSitio, 'Altitud (m.s.n.m.)'))),
      tempMinC: parseFirstNumber(cell(sitioRow, colIndex(hSitio, 'Temp. mínima (°C)'))),
      tempMaxC: parseFirstNumber(cell(sitioRow, colIndex(hSitio, 'Temp. máxima (°C)'))),
      humedadRelativaPct: parseFirstNumber(cell(sitioRow, colIndex(hSitio, 'Humedad relativa (%)'))),
      medioAmbiente: cell(sitioRow, colIndex(hSitio, 'Medio ambiente')),
      cicloTrabajo: cell(sitioRow, colIndex(hSitio, 'Ciclo de trabajo')),
      clasificacionArea: cell(sitioRow, colIndex(hSitio, 'Clasificación de área'))
    };
    console.log('  ', body);
    if (!isDryRun) {
      try {
        const { sitio } = await apiFetch<{ sitio: { id: string } }>(apiBase, devUserEmail, `/api/projects/${projectId}/sitios`, { method: 'POST', body });
        sitioIdReal = sitio.id;
      } catch {
        const { sitio } = await apiFetch<{ sitio: { id: string } }>(apiBase, devUserEmail, `/api/projects/${projectId}/sitios`, { method: 'PATCH', body });
        sitioIdReal = sitio.id;
      }
    }
    stats.sitios++;
  }

  // --- 3) Tuberia ---
  console.log('\n=== 3) Tuberia ===');
  const wsTub = workbook.getWorksheet('Tuberia')!;
  const hTub = sheetHeaders(wsTub);
  const tuberiaIdPorCodigo = new Map<string, string>();
  for (const row of sheetRows(wsTub)) {
    const tubCode = cell(row, colIndex(hTub, 'tuberia_id'))!;
    const body = {
      tagLinea: cell(row, colIndex(hTub, 'Tag de la línea')),
      tamanoDiametro: cell(row, colIndex(hTub, 'Tamaño / Diámetro')),
      materialTuberia: cell(row, colIndex(hTub, 'Material de la tubería')),
      materialRevestimiento: cell(row, colIndex(hTub, 'Material de revestimiento')),
      espesorRevestimiento: cell(row, colIndex(hTub, 'Espesor de revestimiento')),
      schedule: cell(row, colIndex(hTub, 'Schedule')),
      normaBridas: cell(row, colIndex(hTub, 'Norma de bridas')),
      caraBridas: cell(row, colIndex(hTub, 'Cara de bridas')),
      conexionInstrumento: cell(row, colIndex(hTub, 'Conexión para instrumento'))
    };
    if (!isDryRun) {
      const { tuberia } = await apiFetch<{ tuberia: { id: string } }>(apiBase, devUserEmail, `/api/projects/${projectId}/tuberias`, { method: 'POST', body });
      tuberiaIdPorCodigo.set(tubCode, tuberia.id);
    } else {
      tuberiaIdPorCodigo.set(tubCode, `dry-${tubCode}`);
    }
    stats.tuberias++;
  }
  console.log(`  ${stats.tuberias} tuberías`);

  // --- 4) Notas ---
  console.log('\n=== 4) Notas ===');
  const wsNotas = workbook.getWorksheet('Notas')!;
  const hNotas = sheetHeaders(wsNotas);
  const notaIdPorClave = new Map<string, string>(); // "DOC-01::3" -> id real
  for (const row of sheetRows(wsNotas)) {
    const docCode = cell(row, colIndex(hNotas, 'documento_id'))!;
    const numero = Number(cell(row, colIndex(hNotas, 'numero')));
    const texto = cell(row, colIndex(hNotas, 'texto'))!;
    const documentoId = documentoIdPorCodigo.get(docCode);
    if (!documentoId) { console.warn(`  [WARN] Nota sin documento ${docCode}, se salta.`); continue; }
    if (!isDryRun) {
      const { nota } = await apiFetch<{ nota: { id: string } }>(apiBase, devUserEmail, `/api/projects/${projectId}/documentos/${documentoId}/notas`, { method: 'POST', body: { numero, texto } });
      notaIdPorClave.set(`${docCode}::${numero}`, nota.id);
    }
    stats.notas++;
  }
  console.log(`  ${stats.notas} notas`);

  // --- 5) Instrumentos_<Tipo> -> ficha_tecnica + componentes + requisitos + marcas ---
  const FAMILIAS: Array<{ sheet: string; docCode: string; tipo: 'manometro' | 'transmisor' | 'sensor' | 'cuerpoValvula' | 'baliza' | 'fuenteRadioactiva' }> = [
    { sheet: 'Instrumentos_Manometros', docCode: 'DOC-01', tipo: 'manometro' },
    { sheet: 'Instrumentos_Transmisores', docCode: 'DOC-02', tipo: 'transmisor' },
    { sheet: 'Instrumentos_Flujo', docCode: 'DOC-03', tipo: 'sensor' },
    { sheet: 'Instrumentos_Nivel', docCode: 'DOC-04', tipo: 'sensor' },
    { sheet: 'Instrumentos_Densidad', docCode: 'DOC-05', tipo: 'fuenteRadioactiva' },
    { sheet: 'Instrumentos_ValvHidraulicas', docCode: 'DOC-06', tipo: 'cuerpoValvula' },
    { sheet: 'Instrumentos_ValvNeumaticas', docCode: 'DOC-07', tipo: 'cuerpoValvula' },
    { sheet: 'Instrumentos_ValvModuladas', docCode: 'DOC-08', tipo: 'cuerpoValvula' },
    { sheet: 'Instrumentos_Sirenas', docCode: 'DOC-09', tipo: 'baliza' }
  ];

  const fichaIdPorCodigo = new Map<string, string>(); // "INS-DOC-01-01" -> id real

  async function crearComponente(fichaId: string, slug: string, body: Record<string, unknown>) {
    const limpio = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null && v !== undefined));
    if (Object.keys(limpio).length === 0) return;
    if (!isDryRun) {
      await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/fichas-tecnicas/${fichaId}/componentes/${slug}`, { method: 'POST', body: limpio });
    }
    stats.componentes++;
  }

  async function crearRequisitosDesdeFila(fichaId: string, headers: string[], row: any[]) {
    for (const [sufijo, codigo] of Object.entries(REQUISITO_POR_SUFIJO)) {
      // Busca cualquier columna cuyo encabezado TERMINE en "— {sufijo}"
      const idx = headers.findIndex((h) => h.endsWith(`— ${sufijo}`));
      if (idx < 0) continue;
      const raw = cell(row, idx);
      const parsed = valorRequisito(raw);
      if (!parsed) continue;
      const requisitoId = requisitoCache.get(codigo);
      if (!requisitoId) continue;
      if (!isDryRun) {
        await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/fichas-tecnicas/${fichaId}/requisitos`, { method: 'POST', body: { requisitoId, valor: parsed.valor, detalle: parsed.detalle } });
      }
      stats.requisitos++;
    }
  }

  async function crearMarcasDesdeFila(fichaId: string, headers: string[], row: any[], componente: string, headerFabricante: string) {
    const idx = colIndexOpt(headers, headerFabricante);
    const marcas = splitFabricantes(cell(row, idx));
    for (const marca of marcas) {
      const fabricanteId = await ensureFabricante(marca);
      if (!isDryRun) {
        try {
          await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/fichas-tecnicas/${fichaId}/marcas-aceptables`, { method: 'POST', body: { componente, fabricanteId } });
        } catch { /* duplicado -> ignorar */ }
      }
      stats.marcas++;
    }
  }

  for (const familia of FAMILIAS) {
    console.log(`\n=== 5) ${familia.sheet} ===`);
    const ws = workbook.getWorksheet(familia.sheet);
    if (!ws) { console.warn(`  [WARN] Hoja ${familia.sheet} no encontrada, se salta.`); continue; }
    const headers = sheetHeaders(ws);
    const documentoId = documentoIdPorCodigo.get(familia.docCode);

    for (const row of sheetRows(ws)) {
      const codigoInstrumento = cell(row, colIndex(headers, 'instrumento_id'))!;

      if (!isDryRun) {
        const { fichaTecnica } = await apiFetch<{ fichaTecnica: { id: string } }>(apiBase, devUserEmail, `/api/projects/${projectId}/fichas-tecnicas`, {
          method: 'POST', body: { documentoId, codigoReferencia: codigoInstrumento }
        });
        fichaIdPorCodigo.set(codigoInstrumento, fichaTecnica.id);
        stats.fichas++;

        // Componentes segun la familia — usa SOLO columnas que existen
        // en esta hoja (colIndexOpt), nunca inventa un valor.
        const g = (texto: string) => cell(row, colIndexOpt(headers, texto));

        if (familia.sheet === 'Instrumentos_Manometros') {
          await crearComponente(fichaTecnica.id, 'manometro', {
            tipo: cleanTechValue(g('MANÓMETRO — Tipo')),
            rangoMedicion: cleanTechValue(g('MANÓMETRO — Rango de medición')),
            exactitud: cleanTechValue(g('MANÓMETRO — Exactitud')),
            proteccionSobrepresion: cleanTechValue(g('MANÓMETRO — Protección sobrepresión')),
            materialElementoPresion: cleanTechValue(g('MANÓMETRO — Material elemento de presión')),
            materialCaja: cleanTechValue(g('MANÓMETRO — Material de la caja')),
            discoSeguridad: cleanTechValue(g('MANÓMETRO — Disco de seguridad')),
            tamanoColorDial: cleanTechValue(g('MANÓMETRO — Tamaño / Color dial')),
            escala: cleanTechValue(g('MANÓMETRO — Escala')),
            materialAguja: cleanTechValue(g('MANÓMETRO — Material de la aguja')),
            ceroAjustable: cleanTechValue(g('MANÓMETRO — Cero ajustable')),
            fluidoRelleno: cleanTechValue(g('MANÓMETRO — Fluido de relleno')),
            conexionProceso: cleanTechValue(g('MANÓMETRO — Conexión a proceso')),
            gradoProteccion: cleanTechValue(g('MANÓMETRO — Grado de protección'))
          });
          await crearComponente(fichaTecnica.id, 'sello-diafragma', {
            tipo: cleanTechValue(g('SELLO DE DIAFRAGMA — Tipo')),
            materialDiafragma: cleanTechValue(g('SELLO DE DIAFRAGMA — Material de diafragma')),
            fluidoLlenado: cleanTechValue(g('SELLO DE DIAFRAGMA — Fluido de llenado')),
            conexionInstrumento: cleanTechValue(g('SELLO DE DIAFRAGMA — Conexión al instrumento')),
            conexionProceso: cleanTechValue(g('SELLO DE DIAFRAGMA — Conexión a proceso')),
            modelo: cleanTechValue(g('SELLO DE DIAFRAGMA — Modelo'))
          });
          await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'manometro', 'MANÓMETRO — Fabricante');
          await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'sello_diafragma', 'SELLO DE DIAFRAGMA — Fabricante');
        }

        if (familia.sheet === 'Instrumentos_Transmisores') {
          await crearComponente(fichaTecnica.id, 'transmisor', {
            tipoSensor: cleanTechValue(g('TRANSMISOR — Tipo de sensor')),
            tipoMedicion: cleanTechValue(g('TRANSMISOR — Tipo de medición')),
            rangoAjustado: cleanTechValue(g('TRANSMISOR — Rango ajustado')),
            exactitud: cleanTechValue(g('TRANSMISOR — Exactitud')),
            sobrepresion: cleanTechValue(g('TRANSMISOR — Sobrepresión')),
            alimentacion: cleanTechValue(g('TRANSMISOR — Alimentación')),
            senalSalida: cleanTechValue(g('TRANSMISOR — Señal de salida')),
            protocoloComunicacion: cleanTechValue(g('TRANSMISOR — Protocolo de comunicación')),
            conexionElectrica: cleanTechValue(g('TRANSMISOR — Conexión eléctrica')),
            conexionProceso: cleanTechValue(g('TRANSMISOR — Conexión a proceso')),
            ajusteZeroSpan: cleanTechValue(g('TRANSMISOR — Ajuste de Zero y Span')),
            gradoProteccion: cleanTechValue(g('TRANSMISOR — Grado de protección'))
          });
          await crearComponente(fichaTecnica.id, 'sello-diafragma', {
            tipo: cleanTechValue(g('SELLO DE DIAFRAGMA — Tipo')),
            materialDiafragma: cleanTechValue(g('SELLO DE DIAFRAGMA — Material de diafragma')),
            conexionInstrumento: cleanTechValue(g('SELLO DE DIAFRAGMA — Conexión al instrumento')),
            conexionProceso: cleanTechValue(g('SELLO DE DIAFRAGMA — Conexión a proceso')),
            modelo: cleanTechValue(g('SELLO DE DIAFRAGMA — Modelo'))
          });
          await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'transmisor', 'TRANSMISOR — Fabricante');
          await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'sello_diafragma', 'SELLO DE DIAFRAGMA — Fabricante');
        }

        if (familia.sheet === 'Instrumentos_Flujo') {
          await crearComponente(fichaTecnica.id, 'sensor', {
            tipo: cleanTechValue(g('SENSOR (FLOWTUBE) — Tipo')),
            materialSensor: cleanTechValue(g('SENSOR (FLOWTUBE) — Material del sensor / liner')),
            montajeConfiguracion: cleanTechValue(g('SENSOR (FLOWTUBE) — Montaje / Configuración')),
            gradoProteccion: cleanTechValue(g('SENSOR (FLOWTUBE) — Grado de protección'))
          });
          await crearComponente(fichaTecnica.id, 'transmisor', {
            alimentacion: cleanTechValue(g('TRANSMISOR INDICADOR — Alimentación eléctrica')),
            rangoAjustado: cleanTechValue(g('TRANSMISOR INDICADOR — Rango ajustado')),
            senalSalida: cleanTechValue(g('TRANSMISOR INDICADOR — Salida de transmisor')),
            exactitud: cleanTechValue(g('TRANSMISOR INDICADOR — Exactitud')),
            protocoloComunicacion: cleanTechValue(g('TRANSMISOR INDICADOR — Protocolo de comunicación')),
            conexionElectrica: cleanTechValue(g('TRANSMISOR INDICADOR — Conexión eléctrica')),
            gradoProteccion: cleanTechValue(g('TRANSMISOR INDICADOR — Grado de protección')),
            montaje: cleanTechValue(g('TRANSMISOR INDICADOR — Montaje'))
          });
          const pantalla = cleanTechValue(g('TRANSMISOR INDICADOR — Pantalla'));
          if (pantalla) await crearComponente(fichaTecnica.id, 'indicador', { pantalla, esIntegrado: true });
          await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'sensor', 'SENSOR (FLOWTUBE) — Fabricante');
          await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'transmisor', 'TRANSMISOR INDICADOR — Fabricante');
        }

        if (familia.sheet === 'Instrumentos_Nivel') {
          await crearComponente(fichaTecnica.id, 'sensor', {
            tipo: cleanTechValue(g('SENSOR - TRANSMISOR — Tipo de sensor')),
            frecuenciaOperacion: cleanTechValue(g('SENSOR - TRANSMISOR — Frecuencia de operación')),
            conexionProceso: cleanTechValue(g('SENSOR - TRANSMISOR — Conexión a proceso')),
            anguloHaz: cleanTechValue(g('SENSOR - TRANSMISOR — Ángulo de apertura de haz')),
            deadBand: cleanTechValue(g('SENSOR - TRANSMISOR — Dead band')),
            rangoMedicion: cleanTechValue(g('SENSOR - TRANSMISOR — Rango de medición'))
          });
          await crearComponente(fichaTecnica.id, 'transmisor', {
            tipo: cleanTechValue(g('SENSOR - TRANSMISOR — Tipo de transmisor')),
            alimentacion: cleanTechValue(g('SENSOR - TRANSMISOR — Alimentación')),
            rangoAjustado: cleanTechValue(g('SENSOR - TRANSMISOR — Rango ajustado')),
            senalSalida: cleanTechValue(g('SENSOR - TRANSMISOR — Señal de salida')),
            exactitud: cleanTechValue(g('SENSOR - TRANSMISOR — Exactitud')),
            repetibilidad: cleanTechValue(g('SENSOR - TRANSMISOR — Repetibilidad')),
            ajusteZeroSpan: cleanTechValue(g('SENSOR - TRANSMISOR — Ajuste de Zero y Span')),
            materialCarcasa: cleanTechValue(g('SENSOR - TRANSMISOR — Material de carcasa')),
            gradoProteccion: cleanTechValue(g('SENSOR - TRANSMISOR — Grado de protección')),
            conexionElectrica: cleanTechValue(g('SENSOR - TRANSMISOR — Conexión eléctrica'))
          });
          const indicadorIntegrado = cleanTechValue(g('SENSOR - TRANSMISOR — Indicador integrado'));
          if (indicadorIntegrado) await crearComponente(fichaTecnica.id, 'indicador', { esIntegrado: valorRequisito(indicadorIntegrado)?.valor === 'REQUERIDO' });
          await crearComponente(fichaTecnica.id, 'indicador', {
            tipo: cleanTechValue(g('INDICADOR REMOTO — Tipo')),
            alimentacion: cleanTechValue(g('INDICADOR REMOTO — Alimentación')),
            consumoElectrico: cleanTechValue(g('INDICADOR REMOTO — Consumo eléctrico')),
            pantalla: cleanTechValue(g('INDICADOR REMOTO — Pantalla')),
            escala: cleanTechValue(g('INDICADOR REMOTO — Escala')),
            teclado: cleanTechValue(g('INDICADOR REMOTO — Teclado')),
            entradaCable: cleanTechValue(g('INDICADOR REMOTO — Entrada de cable')),
            materialCarcasa: cleanTechValue(g('INDICADOR REMOTO — Material de la carcasa')),
            gradoProteccion: cleanTechValue(g('INDICADOR REMOTO — Grado de protección')),
            montaje: cleanTechValue(g('INDICADOR REMOTO — Montaje')),
            esIntegrado: false
          });
          await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'sensor', 'SENSOR - TRANSMISOR — Fabricante');
          await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'indicador', 'INDICADOR REMOTO — Fabricante');
        }

        if (familia.sheet === 'Instrumentos_Densidad') {
          await crearComponente(fichaTecnica.id, 'fuente-radioactiva', {
            tipo: cleanTechValue(g('FUENTE RADIOACTIVA — Tipo')),
            elementoRadioactivo: cleanTechValue(g('FUENTE RADIOACTIVA — Elemento radioactivo')),
            intensidadRadiacion: cleanTechValue(g('FUENTE RADIOACTIVA — Intensidad de radiación')),
            actividadMaxima: cleanTechValue(g('FUENTE RADIOACTIVA — Actividad máxima permisible')),
            materialBlindaje: cleanTechValue(g('FUENTE RADIOACTIVA — Material de blindaje')),
            mecanismoBloqueoShutter: cleanTechValue(g('FUENTE RADIOACTIVA — Mecanismo de bloqueo del shutter')),
            asasManipulacion: cleanTechValue(g('FUENTE RADIOACTIVA — Asas para manipulación/levantamiento')),
            conexionProceso: cleanTechValue(g('FUENTE RADIOACTIVA — Conexión a proceso')),
            modelo: cleanTechValue(g('FUENTE RADIOACTIVA — Modelo'))
          });
          await crearComponente(fichaTecnica.id, 'sensor', {
            tipo: cleanTechValue(g('SENSOR (DETECTOR) — Tipo')),
            conexionProceso: cleanTechValue(g('SENSOR (DETECTOR) — Conexión a proceso')),
            posicionMontaje: cleanTechValue(g('SENSOR (DETECTOR) — Posición de montaje')),
            requerimientoTuberiaRecta: cleanTechValue(g('SENSOR (DETECTOR) — Requerimiento tubería recta'))
          });
          await crearComponente(fichaTecnica.id, 'transmisor', {
            tipo: cleanTechValue(g('TRANSMISOR — Tipo')),
            alimentacion: cleanTechValue(g('TRANSMISOR — Alimentación')),
            consumo: cleanTechValue(g('TRANSMISOR — Consumo')),
            rangoTransmisor: cleanTechValue(g('TRANSMISOR — Rango del transmisor')),
            rangoAjustado: cleanTechValue(g('TRANSMISOR — Rango ajustado')),
            senalSalida: cleanTechValue(g('TRANSMISOR — Salida')),
            exactitud: cleanTechValue(g('TRANSMISOR — Exactitud del conjunto')),
            repetibilidad: cleanTechValue(g('TRANSMISOR — Repetibilidad')),
            protocoloComunicacion: cleanTechValue(g('TRANSMISOR — Protocolo de comunicación')),
            ajusteZeroSpan: cleanTechValue(g('TRANSMISOR — Ajuste de zero y span')),
            compensacionDeterioroFuente: cleanTechValue(g('TRANSMISOR — Compensación de deterioro de la fuente')),
            inmunidadSaturacion: cleanTechValue(g('TRANSMISOR — Inmunidad de saturación')),
            materialCarcasa: cleanTechValue(g('TRANSMISOR — Material de carcasa')),
            gradoProteccion: cleanTechValue(g('TRANSMISOR — Grado de protección')),
            montaje: cleanTechValue(g('TRANSMISOR — Montaje')),
            conexionElectrica: cleanTechValue(g('TRANSMISOR — Conexión eléctrica'))
          });
          await crearComponente(fichaTecnica.id, 'indicador', {
            tipo: cleanTechValue(g('INDICADOR REMOTO — Tipo')),
            alimentacion: cleanTechValue(g('INDICADOR REMOTO — Fuente de alimentación')),
            pantalla: cleanTechValue(g('INDICADOR REMOTO — Pantalla')),
            configuracionLocal: cleanTechValue(g('INDICADOR REMOTO — Configuración local')),
            conexionElectrica: cleanTechValue(g('INDICADOR REMOTO — Conexión eléctrica')),
            montaje: cleanTechValue(g('INDICADOR REMOTO — Montaje')),
            materialCarcasa: cleanTechValue(g('INDICADOR REMOTO — Material de la carcasa')),
            gradoProteccion: cleanTechValue(g('INDICADOR REMOTO — Grado de protección')),
            escala: cleanTechValue(g('INDICADOR REMOTO — Escala')),
            longitudMaxCable: cleanTechValue(g('INDICADOR REMOTO — Longitud máx. cable indicador-sensor'))
          });
          await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'fuente_radioactiva', 'FUENTE RADIOACTIVA — Fabricante');
          await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'transmisor', 'TRANSMISOR — Fabricante');
          await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'indicador', 'INDICADOR REMOTO — Fabricante');
        }

        if (familia.sheet.startsWith('Instrumentos_Valv')) {
          const esNeum = familia.sheet === 'Instrumentos_ValvNeumaticas';
          const esMod = familia.sheet === 'Instrumentos_ValvModuladas';
          await crearComponente(fichaTecnica.id, 'cuerpo-valvula', {
            tipoCuerpo: cleanTechValue(g('VÁLVULA / TRIM — Tipo') ?? g('VÁLVULA / TRIM — Tipo de válvula') ?? g('VÁLVULA / TRIM — Tipo de cuerpo')),
            tamanoNominal: cleanTechValue(g('VÁLVULA / TRIM — Tamaño') ?? g('VÁLVULA / TRIM — Tamaño (NPS)')),
            tipoConexion: cleanTechValue(g('VÁLVULA / TRIM — Tipo de conexión')),
            materialCuerpo: cleanTechValue(g('VÁLVULA / TRIM — Material de cuerpo') ?? g('VÁLVULA / TRIM — Material del cuerpo')),
            recubrimientoExterior: cleanTechValue(g('VÁLVULA / TRIM — Recubrimiento exterior')),
            marcado: cleanTechValue(g('VÁLVULA / TRIM — Marcado')),
            posicionNormal: cleanTechValue(g('VÁLVULA / TRIM — Posición normalmente')),
            ruidoOperador: cleanTechValue(g('VÁLVULA / TRIM — Ruido permisible (dB)') ?? g('VÁLVULA / TRIM — Ruido permisible'))?.match(/[<≤]/)?.[0] ?? null,
            ruidoMaxDb: parseFirstNumber(g('VÁLVULA / TRIM — Ruido permisible (dB)') ?? g('VÁLVULA / TRIM — Ruido permisible')),
            // La distancia de medicion es siempre "01 metro"/"1 m" en las
            // 3 hojas de valvula (confirmado en _T_VALVULA de la propia
            // usuaria) — no hay un numero explicito separado en ninguna
            // celda real, se completa con la constante ya verificada.
            ruidoDistanciaM: (g('VÁLVULA / TRIM — Ruido permisible (dB)') ?? g('VÁLVULA / TRIM — Ruido permisible')) ? 1.0 : null,
            posicionMontaje: cleanTechValue(g('VÁLVULA / TRIM — Posición de montaje')),
            trimTipo: cleanTechValue(g('VÁLVULA / TRIM — Trim - Tipo')),
            direccionFlujo: cleanTechValue(g('VÁLVULA / TRIM — Dirección de flujo')),
            caracteristicaFlujo: cleanTechValue(g('VÁLVULA / TRIM — Característica de la válvula')),
            recorridoObturador: cleanTechValue(g('VÁLVULA / TRIM — Recorrido del obturador')),
            materialObturador: cleanTechValue(g('VÁLVULA / TRIM — Material de cuchilla') ?? g('VÁLVULA / TRIM — Material de cuchilla / disco / bola') ?? g('VÁLVULA / TRIM — Material del obturador')),
            materialMangas: cleanTechValue(g('VÁLVULA / TRIM — Material de las mangas')),
            materialVastago: cleanTechValue(g('VÁLVULA / TRIM — Material de vástago') ?? g('VÁLVULA / TRIM — Material de vástago / eje')),
            materialAsiento: cleanTechValue(g('VÁLVULA / TRIM — Material de asiento') ?? g('VÁLVULA / TRIM — Material del asiento')),
            materialSello: cleanTechValue(g('VÁLVULA / TRIM — Material de sello') ?? g('VÁLVULA / TRIM — Material del sello')),
            materialSelloVastago: cleanTechValue(g('VÁLVULA / TRIM — Material de sello de vástago')),
            cvValvula: parseFirstNumber(g('VÁLVULA / TRIM — Cv de la válvula')),
            claseHermeticidad: cleanTechValue(g('VÁLVULA / TRIM — Clase de cierre') ?? g('VÁLVULA / TRIM — Clase de fuga'))
          });
          await crearComponente(fichaTecnica.id, 'actuador', {
            tipoActuador: cleanTechValue(g('ACTUADOR — Tipo de actuador')),
            recorridoActuador: cleanTechValue(g('ACTUADOR — Recorrido')),
            accionFalla: cleanTechValue(g('ACTUADOR — Acción de falla')),
            principioOperacion: cleanTechValue(g('ACTUADOR — Principio de operación')),
            presionTrabajo: cleanTechValue(g('ACTUADOR — Presión de trabajo mín./máx.') ?? g('ACTUADOR — Presión de trabajo nom./máx.')),
            torque: cleanTechValue(g('ACTUADOR — Torque')),
            alimentacion: cleanTechValue(g('ACTUADOR — Alimentación del actuador')),
            tiempoAperturaCierre: cleanTechValue(g('ACTUADOR — Tiempo de apertura/cierre (s)')),
            conexionActuador: cleanTechValue(g('ACTUADOR — Conexión neumática') ?? g('ACTUADOR — Conexión a proceso')),
            modelo: cleanTechValue(g('ACTUADOR — Modelo'))
          });
          if (!esMod) {
            const cantidadInterruptores = parseFirstNumber(g('INTERRUPTORES DE POSICIÓN — Cantidad de interruptores')) ?? 0;
            for (let i = 0; i < cantidadInterruptores; i++) {
              await crearComponente(fichaTecnica.id, 'interruptor-posicion', {
                tecnologia: cleanTechValue(g('INTERRUPTORES DE POSICIÓN — Tecnología')),
                tipoContacto: cleanTechValue(g('INTERRUPTORES DE POSICIÓN — Tipo de contacto')),
                corrienteContacto: cleanTechValue(g('INTERRUPTORES DE POSICIÓN — Corriente de contacto')),
                cantidadContactos: cleanTechValue(g('INTERRUPTORES DE POSICIÓN — Cantidad de contactos por interruptor')),
                conexionElectrica: cleanTechValue(g('INTERRUPTORES DE POSICIÓN — Conexión eléctrica')),
                gradoProteccion: cleanTechValue(g('INTERRUPTORES DE POSICIÓN — Grado de protección')),
                modelo: cleanTechValue(g('INTERRUPTORES DE POSICIÓN — Modelo'))
              });
            }
            await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'interruptor_posicion', 'INTERRUPTORES DE POSICIÓN — Fabricante');
          }
          if (esMod) {
            await crearComponente(fichaTecnica.id, 'posicionador', {
              tipo: cleanTechValue(g('POSICIONADOR — Tipo')),
              accion: cleanTechValue(g('POSICIONADOR — Acción')),
              tipoMontaje: cleanTechValue(g('POSICIONADOR — Tipo de montaje')),
              senalControl: cleanTechValue(g('POSICIONADOR — Señal de control')),
              senalPosicion: cleanTechValue(g('POSICIONADOR — Señal de posición')),
              protocoloComunicacion: cleanTechValue(g('POSICIONADOR — Protocolo de comunicación')),
              medidorPresion: cleanTechValue(g('POSICIONADOR — Medidor de presión')),
              funcionDiagnostico: cleanTechValue(g('POSICIONADOR — Función de diagnóstico')),
              materialCarcasa: cleanTechValue(g('POSICIONADOR — Material de la carcasa')),
              conexionNeumaticaCantidad: cleanTechValue(g('POSICIONADOR — Conexión neumática / Cantidad')),
              conexionElectricaCantidad: cleanTechValue(g('POSICIONADOR — Conexión eléctrica / Cantidad')),
              gradoProteccion: cleanTechValue(g('POSICIONADOR — Grado de protección')),
              modelo: cleanTechValue(g('POSICIONADOR — Modelo'))
            });
            await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'posicionador', 'POSICIONADOR — Fabricante');
            await crearComponente(fichaTecnica.id, 'unidad-control', {
              tipoMontaje: cleanTechValue(g('UNIDAD DE MANTENIMIENTO / SET DE AIRE — Tipo de montaje')),
              voltajeOperacion: cleanTechValue(g('UNIDAD DE MANTENIMIENTO / SET DE AIRE — Voltaje de operación')),
              presionOperacion: cleanTechValue(g('UNIDAD DE MANTENIMIENTO / SET DE AIRE — Presión de operación'))
            });
            await crearComponente(fichaTecnica.id, 'envolvente', {
              funcion: 'set_aire',
              dimensionesWhd: cleanTechValue(g('UNIDAD DE MANTENIMIENTO / SET DE AIRE — Caja - Dimensiones (WxHxD)')),
              material: cleanTechValue(g('UNIDAD DE MANTENIMIENTO / SET DE AIRE — Caja - Material')),
              espesor: cleanTechValue(g('UNIDAD DE MANTENIMIENTO / SET DE AIRE — Caja - Espesor')),
              gradoProteccion: cleanTechValue(g('UNIDAD DE MANTENIMIENTO / SET DE AIRE — Caja - Grado de protección')),
              placaMontaje: cleanTechValue(g('UNIDAD DE MANTENIMIENTO / SET DE AIRE — Caja - Placa de montaje'))
            });
            await crearComponente(fichaTecnica.id, 'set-aire', {
              tipo: cleanTechValue(g('UNIDAD DE MANTENIMIENTO / SET DE AIRE — Set de aire - Tipo')),
              rangoPresion: cleanTechValue(g('UNIDAD DE MANTENIMIENTO / SET DE AIRE — Rango de presión')),
              conexionNeumatica: cleanTechValue(g('UNIDAD DE MANTENIMIENTO / SET DE AIRE — Conexión neumática')),
              manometro: cleanTechValue(g('UNIDAD DE MANTENIMIENTO / SET DE AIRE — Manómetro')),
              modelo: cleanTechValue(g('UNIDAD DE MANTENIMIENTO / SET DE AIRE — Modelo'))
            });
            await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'set_aire', 'UNIDAD DE MANTENIMIENTO / SET DE AIRE — Fabricante');
          }
          if (esNeum) {
            await crearComponente(fichaTecnica.id, 'unidad-control', {
              tipoMontaje: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Tipo de montaje')),
              voltajeOperacion: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Voltaje de operación')),
              consumoW: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Consumo (W)')),
              presionOperacion: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Presión de operación')),
              accionFalla: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Acción de falla'))
            });
            await crearComponente(fichaTecnica.id, 'set-aire', {
              tipo: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Set de aire - Tipo')),
              rangoPresion: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Rango de presión')),
              conexionNeumatica: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Conexión neumática')),
              cantidad: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Cantidad')),
              manometro: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Manómetro')),
              reguladorVelocidad: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Fitting regulador de velocidad')),
              kitPuestaTierra: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Kit de puesta a tierra')),
              modelo: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Modelo'))
            });
            await crearComponente(fichaTecnica.id, 'selector-maniobra', {
              funcion: 'selector_remoto_local',
              tipo: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Selector remoto/local - Tipo')),
              tipoContacto: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Tipo de contacto')),
              corrienteContacto: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Corriente de contacto')),
              cantidadContactos: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Cantidad de contactos')),
              ranuraCandado: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Ranura para candado de bloqueo')),
              gradoProteccion: cleanTechValue(g('UNIDAD DE CONTROL / SET DE AIRE / SELECTOR — Grado de protección'))
            });
            const cantSolenoides = parseFirstNumber(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Cantidad de solenoides')) ?? 0;
            for (let i = 0; i < cantSolenoides; i++) {
              await crearComponente(fichaTecnica.id, 'solenoide', {
                tipo: cleanTechValue(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Solenoide - Tipo')),
                cantidadValvulas: cleanTechValue(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Cantidad de válvulas')),
                voltajeOperacion: cleanTechValue(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Voltaje de operación')),
                conexionNeumatica: cleanTechValue(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Conexión neumática')),
                gradoProteccion: cleanTechValue(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Grado de protección'))
              });
            }
            await crearComponente(fichaTecnica.id, 'envolvente', {
              funcion: 'solenoide',
              tipoMontaje: cleanTechValue(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Caja - Dimensiones (WxHxD)')) ? null : null,
              dimensionesWhd: cleanTechValue(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Caja - Dimensiones (WxHxD)')),
              material: cleanTechValue(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Material')),
              espesor: cleanTechValue(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Espesor')),
              gradoProteccion: cleanTechValue(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Grado de protección')),
              placaMontaje: cleanTechValue(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Placa de montaje'))
            });
            await crearComponente(fichaTecnica.id, 'selector-maniobra', {
              funcion: 'maniobra_local',
              tipo: cleanTechValue(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Maniobra - Tipo')),
              corrienteContacto: cleanTechValue(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Corriente de contacto')),
              cantidadContactos: cleanTechValue(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Cantidad de contacto')),
              gradoProteccion: cleanTechValue(g('VÁLVULA SOLENOIDE / CAJA / MANIOBRA — Grado de protección'))
            });
          }
          if (familia.sheet === 'Instrumentos_ValvHidraulicas') {
            await crearComponente(fichaTecnica.id, 'envolvente', {
              funcion: 'conexiones',
              tipoMontaje: cleanTechValue(g('CAJA DE CONEXIONES — Tipo de montaje')),
              voltaje: cleanTechValue(g('CAJA DE CONEXIONES — Voltaje de operación')),
              dimensionesWhd: cleanTechValue(g('CAJA DE CONEXIONES — Dimensiones (WxHxD)')),
              material: cleanTechValue(g('CAJA DE CONEXIONES — Material')),
              espesor: cleanTechValue(g('CAJA DE CONEXIONES — Espesor')),
              gradoProteccion: cleanTechValue(g('CAJA DE CONEXIONES — Grado de protección')),
              placaMontaje: cleanTechValue(g('CAJA DE CONEXIONES — Placa de montaje'))
            });
            await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'envolvente', 'CAJA DE CONEXIONES — Fabricante');
          }
          await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'cuerpo_valvula', 'VÁLVULA / TRIM — Fabricante');
          await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'actuador', 'ACTUADOR — Fabricante');
        }

        if (familia.sheet === 'Instrumentos_Sirenas') {
          await crearComponente(fichaTecnica.id, 'baliza', {
            tipo: cleanTechValue(g('BALIZA — Tipo')),
            tipoIluminacion: cleanTechValue(g('BALIZA — Tipo de iluminación')),
            colorLente: cleanTechValue(g('BALIZA — Color de lente')),
            energiaDestello: cleanTechValue(g('BALIZA — Energía de destello')),
            materialCarcasa: cleanTechValue(g('BALIZA — Material de la carcasa')),
            materialLente: cleanTechValue(g('BALIZA — Material de lente')),
            voltajeAlimentacion: cleanTechValue(g('BALIZA — Voltaje de alimentación')),
            consumoElectrico: cleanTechValue(g('BALIZA — Consumo eléctrico')),
            tipoMontaje: cleanTechValue(g('BALIZA — Tipo de montaje')),
            conexionElectrica: cleanTechValue(g('BALIZA — Conexión eléctrica')),
            gradoProteccion: cleanTechValue(g('BALIZA — Grado de protección')),
            vidaUtil: cleanTechValue(g('BALIZA — Vida útil')),
            modelo: cleanTechValue(g('BALIZA — Modelo'))
          });
          await crearComponente(fichaTecnica.id, 'sirena', {
            tipo: cleanTechValue(g('SIRENA — Tipo')),
            intensidadSonora: cleanTechValue(g('SIRENA — Intensidad sonora')),
            material: cleanTechValue(g('SIRENA — Material')),
            tonos: cleanTechValue(g('SIRENA — Tonos')),
            volumen: cleanTechValue(g('SIRENA — Volumen')),
            voltajeAlimentacion: cleanTechValue(g('SIRENA — Voltaje de alimentación')),
            consumoElectrico: cleanTechValue(g('SIRENA — Consumo eléctrico')),
            tipoMontaje: cleanTechValue(g('SIRENA — Tipo de montaje')),
            conexionElectrica: cleanTechValue(g('SIRENA — Conexión eléctrica')),
            gradoProteccion: cleanTechValue(g('SIRENA — Grado de protección')),
            modelo: cleanTechValue(g('SIRENA — Modelo'))
          });
          await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'baliza', 'BALIZA — Fabricante');
          await crearMarcasDesdeFila(fichaTecnica.id, headers, row, 'sirena', 'SIRENA — Fabricante');
        }

        await crearRequisitosDesdeFila(fichaTecnica.id, headers, row);
      } else {
        fichaIdPorCodigo.set(codigoInstrumento, `dry-${codigoInstrumento}`);
        stats.fichas++;
      }
    }
    console.log(`  ${sheetRows(ws).length} fichas técnicas`);
  }

  // --- 6) Tags: matchear contra instrumento YA existente, actualizar y asociar ---
  console.log('\n=== 6) Tags ===');
  const wsTags = workbook.getWorksheet('Tags')!;
  const hTags = sheetHeaders(wsTags);
  const { instruments } = await apiFetch<{ instruments: Array<{ id: string; tagInstrumento: string }> }>(apiBase, devUserEmail, `/api/projects/${projectId}/instruments`);
  const instrumentoIdPorTag = new Map(instruments.map((i) => [i.tagInstrumento, i.id]));

  for (const row of sheetRows(wsTags)) {
    const tag = cell(row, colIndex(hTags, 'tag'))!;
    const docCode = cell(row, colIndex(hTags, 'documento_id'));
    const insCode = cell(row, colIndex(hTags, 'instrumento_id'));
    const tubCode = cell(row, colIndex(hTags, 'tuberia_id'));

    const instrumentoId = instrumentoIdPorTag.get(tag);
    if (!instrumentoId) {
      console.warn(`  [WARN] Tag "${tag}" no existe todavía en nucleo.instrumento (¿pendiente de P&ID?) — se salta.`);
      stats.tagsSinMatch++;
      continue;
    }

    const fichaTecnicaId = insCode ? fichaIdPorCodigo.get(insCode) : undefined;
    const tuberiaId = tubCode ? tuberiaIdPorCodigo.get(tubCode) : undefined;
    const documentoId = docCode ? documentoIdPorCodigo.get(docCode) : undefined;

    if (!isDryRun) {
      const patchBody: Record<string, unknown> = {};
      if (fichaTecnicaId) patchBody.fichaTecnicaId = fichaTecnicaId;
      if (tuberiaId) patchBody.tuberiaId = tuberiaId;
      if (sitioIdReal) patchBody.sitioId = sitioIdReal;
      if (Object.keys(patchBody).length > 0) {
        await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/instruments/${instrumentoId}`, { method: 'PATCH', body: patchBody });
      }
      if (documentoId) {
        try {
          await apiFetch(apiBase, devUserEmail, `/api/projects/${projectId}/documentos/${documentoId}/instrumentos/${instrumentoId}`, { method: 'POST' });
        } catch { /* ya asociado */ }
      }
    }
    stats.tagsMatcheados++;
  }

  console.log('\n=== Resumen ===');
  console.log(stats);
  if (isDryRun) console.log('\n(dry-run: no se escribió nada — correr con --apply para ejecutar)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
