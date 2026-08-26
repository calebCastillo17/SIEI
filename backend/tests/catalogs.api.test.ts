/*
 * Pruebas de API para los 6 catálogos globales generados por
 * createSimpleCatalogRouter (interface-types, com-types,
 * com-media-types = dominio abierto, escribibles; revision-states,
 * alarm-priorities, pnid-states = lista cerrada confirmada, solo lectura).
 *
 * Autocontenida. Los catálogos escribibles no tienen soft delete (sin
 * `activo`), así que los códigos de prueba que se crean quedan permanentes
 * — se documenta como limitación conocida, igual que cat_modulo_io.
 *
 * Uso: npm run test:catalogs   (ver backend/package.json)
 */

import { spawn, type ChildProcess } from 'node:child_process';

const PORT = Number(process.env.TEST_PORT ?? 3108);
const BASE = `http://localhost:${PORT}`;

const USERS = {
  admin: 'admin@siei.local',
  editor: 'editor@siei.local',
  viewer: 'viewer@siei.local'
} as const;

type UserKey = keyof typeof USERS;

let pass = 0;
let fail = 0;
const failures: string[] = [];

async function call(
  user: UserKey,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Dev-User-Email': USERS[user]
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  let json: any = null;
  try { json = await res.json(); } catch { /* sin body */ }

  return { status: res.status, json };
}

function check(label: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    pass++;
    console.log(`PASS: ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`FAIL: ${label}` + (extra ? ` -- ${JSON.stringify(extra)}` : ''));
  }
}

async function waitForHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health/db`);
      if (res.ok) {
        const json = await res.json();
        if (json?.connection === true) return true;
      }
    } catch {
      // el servidor todavía no acepta conexiones
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return false;
}

const WRITABLE_CATALOGS = [
  { path: '/api/catalogs/interface-types', label: 'interface-types' },
  { path: '/api/catalogs/com-types', label: 'com-types' },
  { path: '/api/catalogs/com-media-types', label: 'com-media-types' }
];

const READONLY_CATALOGS = [
  { path: '/api/catalogs/revision-states', label: 'revision-states', expectedCode: 'PENDIENTE' },
  { path: '/api/catalogs/alarm-priorities', label: 'alarm-priorities', expectedCode: 'BAJA' },
  { path: '/api/catalogs/pnid-states', label: 'pnid-states', expectedCode: 'OK' },
  { path: '/api/catalogs/signal-classes', label: 'signal-classes', expectedCode: 'CONTROL' },
  { path: '/api/catalogs/io-types', label: 'io-types', expectedCode: 'AI' },
  { path: '/api/catalogs/com-directions', label: 'com-directions', expectedCode: 'IN' }
];


async function main(): Promise<void> {
  let serverProcess: ChildProcess | null = null;

  const alreadyRunning = await waitForHealth(500);

  if (!alreadyRunning) {
    console.log(`Ningún backend respondiendo en ${BASE}; levantando uno para la prueba...`);

    serverProcess = spawn(
      'npx',
      ['tsx', 'src/server.ts'],
      {
        cwd: new URL('..', import.meta.url).pathname,
        env: { ...process.env, PORT: String(PORT) },
        stdio: 'pipe',
        detached: true
      }
    );

    serverProcess.stdout?.on('data', () => {});
    serverProcess.stderr?.on('data', (chunk) => process.stderr.write(chunk));

    const ready = await waitForHealth(20_000);

    if (!ready) {
      console.error('El backend no respondió a tiempo.');
      serverProcess.kill();
      process.exit(1);
    }
  }

  try {
    const runId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // ===================== Catálogos de lista cerrada (solo lectura) =====================
    for (const cat of READONLY_CATALOGS) {
      const list = await call('viewer', 'GET', cat.path);
      check(
        `[${cat.label}] VIEWER puede leer (200) y trae el seed esperado`,
        list.status === 200 && list.json?.items?.some((i: any) => i.codigo === cat.expectedCode),
        list.json
      );

      const oneItem = list.json?.items?.[0];
      if (oneItem) {
        const one = await call('viewer', 'GET', `${cat.path}/${oneItem.id}`);
        check(`[${cat.label}] GET /:id (200)`, one.status === 200 && one.json?.item?.codigo === oneItem.codigo, one.json);
      }

      const adminCreate = await call('admin', 'POST', cat.path, { codigo: `NEW-${runId}` });
      check(
        `[${cat.label}] sin POST expuesto (404, ni siquiera ADMIN puede)`,
        adminCreate.status === 404,
        adminCreate.json
      );

      const invalidId = await call('viewer', 'GET', `${cat.path}/not-a-number`);
      check(`[${cat.label}] GET con id inválido -> 400`, invalidId.status === 400, invalidId.json);

      const missingId = await call('viewer', 'GET', `${cat.path}/999999999`);
      check(`[${cat.label}] GET id inexistente -> 404`, missingId.status === 404, missingId.json);
    }

    // ===================== Catálogos de dominio abierto (escribibles) =====================
    // codigo es NVARCHAR(30) — el sufijo debe ser corto para no chocar con
    // ese límite sin importar cuál de los 3 catálogos se esté probando.
    const shortId = `${Date.now() % 100000}${Math.floor(Math.random() * 100)}`;

    for (const [index, cat] of WRITABLE_CATALOGS.entries()) {
      const listBefore = await call('viewer', 'GET', cat.path);
      check(`[${cat.label}] VIEWER puede leer (200)`, listBefore.status === 200, listBefore.json);

      const editorCreate = await call('editor', 'POST', cat.path, { codigo: `EDITOR-${runId}` });
      check(`[${cat.label}] EDITOR no puede crear (403, no es admin de sistema)`, editorCreate.status === 403, editorCreate.json);

      const codigo = `T${index}-${shortId}`;
      const create = await call('admin', 'POST', cat.path, { codigo, descripcion: 'Creado por test' });
      check(`[${cat.label}] ADMIN crea código nuevo (201)`, create.status === 201 && create.json?.item?.codigo === codigo, create.json);

      const dup = await call('admin', 'POST', cat.path, { codigo });
      check(`[${cat.label}] código duplicado -> 409`, dup.status === 409 && dup.json?.error === 'code_conflict', dup.json);

      const noCodigo = await call('admin', 'POST', cat.path, { descripcion: 'sin codigo' });
      check(`[${cat.label}] sin codigo -> 400`, noCodigo.status === 400, noCodigo.json);

      const getCreated = await call('viewer', 'GET', `${cat.path}/${create.json?.item?.id}`);
      check(`[${cat.label}] el código creado aparece en GET /:id`, getCreated.status === 200 && getCreated.json?.item?.codigo === codigo, getCreated.json);
    }

    const noAuth = await fetch(`${BASE}/api/catalogs/interface-types`);
    check('Sin header de auth -> 401', noAuth.status === 401);

  } finally {
    console.warn(
      'Los 3 catálogos de dominio abierto no tienen soft delete (sin columna activo): ' +
      'los códigos de prueba creados en esta corrida quedan permanentes, ' +
      'igual que cat_modulo_io y par_conductor.'
    );

    if (serverProcess && serverProcess.pid) {
      try {
        process.kill(-serverProcess.pid, 'SIGTERM');
      } catch {
        // ya estaba muerto
      }
    }
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  if (fail > 0) {
    console.log('Fallas:', failures.join(', '));
  }

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERROR FATAL', err);
  process.exit(1);
});
