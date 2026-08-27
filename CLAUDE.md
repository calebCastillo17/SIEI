# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

SIEI = **Sistema Integrado de Entregables de Ingeniería**.

Goal: a modular web platform to manage engineering project information and to generate, control, and review deliverables ("entregables"). It must be designed to support **multiple projects**, not a single hardcoded one.

Initial domain focus is **Instrumentation & Control engineering**. Concepts likely to be part of the system (not a confirmed/final list): proyectos, equipos, instrumentos, señales, señales IO, señales de comunicaciones, RIO, racks, slots, módulos, canales, cables, lazos, documentos, entregables, revisiones.

**The data model, the modules, and the business rules are all still being discovered/defined.** Do not treat the entity list above as a finished schema, and do not treat its presence here as confirmation that any given entity, relationship, or rule is settled — it's the known domain vocabulary, not a spec. See "Working rules" below.

### Current repository state

- **`frontend/`** — Vite React+TS scaffold, still close to the template (see `src/App.tsx`). Not yet wired to anything.
- **`database/`** — **exists and is applied.** Migrations `001`–`003` under `database/migrations/`, smoke tests `001`–`017` under `database/tests/`. See "Database" below.
- **`docs/`** — the design record that produced the schema: `MODELO_CONCEPTUAL_SIEI.md`, `MODELO_LOGICO_SIEI.md`, `MODELO_FISICO_SIEI.md` (the implementation reference), `MATRIZ_COBERTURA_DATOS_SIEI.md` (field-by-field coverage of the source Excel files).
- **`reference_excel/`** — the five legacy Excel workbooks the model was reverse-engineered from. Read-only source of truth for discovery; never modify them.
- **Backend** — does **not** exist yet. Do not create it until explicitly requested.

## Planned architecture (full-stack)

- **Frontend**: React + TypeScript (under `frontend/`).
- **Backend**: Node.js + TypeScript. **Not yet created.**
- **Database**: SQL Server / Azure SQL. **Already created** — see below.

Hard constraints:
- The frontend must **never** connect directly to SQL Server. The backend is the **only** layer with database access.
- Keep frontend, backend, and database concerns separated (e.g. separate top-level packages/folders once backend and DB work begins).
- Prefer a modular, maintainable architecture — the platform is multi-project and multi-module by design, so avoid designs that assume a single project or hardcode Instrumentation & Control specifics where a general mechanism would do.
- SQL Server schema changes must go through migrations — no ad hoc/manual schema edits. Never edit an already-applied migration; add a new numbered one.
- Use stable internal identifiers (surrogate keys) for entities. Do **not** use TAG (the engineering tag/label) as a database primary key.
- **Authorization is enforced by the backend, never by the frontend** — and today, not by the database either (see "Security model").

## Working rules

- Don't invent engineering rules/business logic that haven't been confirmed by the user — this domain (I&C engineering) has real, project-specific conventions that must come from the user, not be assumed.
- When business information needed to proceed is missing, ask before assuming.
- Before significant structural changes (schema, module boundaries, cross-cutting architecture), explain the proposal and its impact before implementing.
- Never delete existing data or structures without explicit authorization.
- Document important architectural decisions as they're made (e.g. in this file or in dedicated docs — ask the user if unsure where).
- Don't implement significant features without first understanding the requirement — clarify scope/behavior with the user before building it.
- When there are multiple viable technical alternatives, present the options (with trade-offs) before picking one.

## Database

SQL Server. Schemas: **`nucleo`** (engineering data), **`cat`** (universal catalogs, no `proyecto_id`), **`seguridad`** (users, roles, project access), **`integracion`** (persistent import history — currently the P&ID/Plant 3D importer; see migration 004).

### Migrations (`database/migrations/`)

| File | Contents |
|---|---|
| `001_initial_schema.sql` | Core: `cat` + `nucleo`, 30 tables, composite FKs for multi-project isolation, filtered unique indexes, 12 triggers. |
| `002_auth_users_roles.sql` | `seguridad`: `usuario`, `rol`, `usuario_proyecto_rol`, the `vw_acceso_proyecto` view, 4 triggers. |
| `003_user_audit.sql` | Adds `created_by` / `updated_by` (`BIGINT NULL`, FK → `seguridad.usuario`) to all 20 `nucleo` tables. |
| `004_pnid_import.sql` | Adds P&ID-origin columns to `nucleo.instrumento` (`tag_anterior`, `tecnologia`, `funcionamiento`, `cuerpo_instrumento`, `conexion_proceso`, `plano_pnid`, `linea_pnid`, `tipo_senal_pnid`, `equipo_asociado_id`/`_tag`); adds `DATOS_MODIFICADOS`/`REQUIERE_REVISION` to `cat.cat_estado_pnid`; creates schema `integracion` with `importacion_pnid` / `importacion_pnid_fila` / `importacion_pnid_resultado` (persistent snapshot + comparison history for the P&ID importer). |

Every migration starts with the seven `SET` options (`ANSI_NULLS`, `ANSI_PADDING`, `ANSI_WARNINGS`, `ARITHABORT`, `CONCAT_NULL_YIELDS_NULL`, `QUOTED_IDENTIFIER` **ON**, `NUMERIC_ROUNDABORT` **OFF**). These are **mandatory**, not decorative: without them every `CREATE UNIQUE INDEX ... WHERE ...` fails with error 1934, and because each index sits in its own `GO` batch the failure does not stop the script — tables and triggers get created while the filtered indexes silently do not. Any connection that later runs DML against these tables needs the same options (most drivers set them correctly; the usual offender is `ARITHABORT OFF` from legacy ODBC/OLE DB).

### Tests (`database/tests/`)

Smoke tests `001`–`018`, run manually against a dev database. They are `BEGIN TRY` / `BEGIN CATCH` blocks that `PRINT` `PASS`/`FAIL` and roll back their own fixtures. **A failure prints but does not fail the process** — they are not usable as a CI gate as written. Several depend on a project with `codigo_proyecto = 'TEST-001'` created by earlier tests, so run them in order.

### P&ID / Plant 3D import (`integracion` schema, migration 004)

Two-phase flow (`backend/src/routes/pnidImports.ts`, `backend/src/lib/pnidImport/`): **PREVIEW** parses the uploaded report, persists a full row-by-row snapshot (`importacion_pnid_fila`, one row per physical Excel row, no exceptions) and a comparison result per row (`importacion_pnid_resultado`, which can also exist *without* a row — `fila_id NULL` — for a Plant3D-managed instrument that vanished from the new report entirely) — and never touches `nucleo.instrumento`. **APPLY** re-validates the batch is still `PREVISUALIZADO`, checks that no affected instrument changed since the preview (`instrumento_updated_at_preview` vs. current `updated_at`; any mismatch aborts the *entire* batch with `409 stale_pnid_preview`, never a partial apply), then applies each row's action inside one transaction.

Identity rule: `(proyecto_id, PnPID)` identifies the P&ID object; `TAG` can change under the same `PnPID` without creating a duplicate (`TAG_MODIFICADO`). No fallback-by-TAG matching during normal import — reusing an old TAG for a genuinely new PnPID is flagged `REQUIERE_REVISION`, never resolved automatically. `NO_EXISTE_EN_PNID` (an instrument's PnPID disappeared from the report) is scored only against instruments where `fuente_pnpid = 'PLANT3D'` — a manually-created instrument is never touched by this comparison. `pnpid` / `fuente_pnpid` on `nucleo.instrumento` are no longer editable through the normal instruments POST/PATCH — only this import flow (and direct DB access) can set them; a manual instrument can still exist indefinitely with `pnpid IS NULL`.

The importer tolerates unknown/missing columns instead of failing: a known column absent from the file produces a warning and is excluded from comparison (never inferred as cleared); an unrecognized column is kept in the row snapshot and reported as a warning, never rejected. Header matching is case/accent/separator-insensitive (Unicode NFD-based, generalizing the legacy Excel macro's normalization).

**Real-world parsing gotcha (found via the actual reference report, `reference_excel/162281-620-Instrument List.xlsx`)**: some Plant 3D exports declare every OOXML namespace with an explicit prefix (`<x:worksheet xmlns:x=".../spreadsheetml/2006/main">` instead of the conventional unprefixed default) and reference an Excel Table object via an absolute relationship target — both are valid OOXML but exceljs's parser cannot load them. `backend/src/lib/pnidImport/parseExcel.ts`'s `normalizeNamespacedXlsx()` rewrites the specific namespaces exceljs expects unprefixed and strips the Excel Table object entirely (SIEI never reads it) before handing the buffer to exceljs. This runs unconditionally and is a no-op on normally-formed files.

### Key modelling decisions (details in `docs/MODELO_FISICO_SIEI.md`)

- **Multi-project isolation** is structural: every `nucleo` table carries `proyecto_id`, declares `UNIQUE (id, proyecto_id)`, and child FKs are **composite** `(padre_id, proyecto_id)`. Linking rows across two projects is rejected by the engine, not by convention.
- **Logical deletion**: `activo BIT` instead of `DELETE`. Uniqueness of tags and physical resources is enforced with **filtered unique indexes** (`WHERE activo = 1`), so a retired tag or a freed channel/conductor can be reused without losing history.
- **Deactivation cascades downward, never upward**: SEÑAL → RUTA_CONEXION → TRAMO_CONEXION. Reactivating a parent never restores its children — the resources they held may have been taken in the meantime.
- **Resources in use cannot be deactivated**: canal, módulo, punto_conexion and cable in active use are rejected, never silently unassigned.
- **`clase_senal_id`** (`CONTROL` / `COM`) is explicit and mandatory — the domain of a signal is never inferred from `tipo_io_id` / `canal_id` / `direccion_com_id`.
- **`updated_at`** is the backend's responsibility. The exception is automatic trigger cascades, which write it themselves because no application statement touches those rows.
- **Building a multi-segment route** (`INSTRUMENTO → CAJA → RIO`) must happen in **one statement**: validation runs after every statement, so an intermediate state ending at a CAJA is rejected. The backend must insert/update all segments of a route atomically.

## Security model

Three functional roles: **ADMIN**, **EDITOR**, **VIEWER**.

| Role | Read | Create / modify | Deactivate | Administer |
|---|---|---|---|---|
| ADMIN | ✔ | ✔ | ✔ | ✔ |
| EDITOR | ✔ | ✔ | ✘ | ✘ |
| VIEWER | ✔ | ✘ | ✘ | ✘ |

- **Roles are assigned per project** via `seguridad.usuario_proyecto_rol`. The same user can be EDITOR on one project and VIEWER or ADMIN on another. At most one active assignment per (user, project).
- **`usuario.es_admin_sistema = 1`** is a global administrator: ADMIN over every active project, without explicit assignments. It is not a fourth role. It is the highest privilege in the system and has no database-level guard — the backend must never expose it through a generic user-update endpoint.
- **`seguridad.vw_acceso_proyecto`** resolves effective access per user and project, and is the intended source for the backend's authorization checks.
- **SIEI never stores passwords.** Authentication is delegated to an external OIDC provider, initially Microsoft Entra ID. External identity is `auth_issuer` (claim `iss`) + `auth_subject` (claim `sub`), both NULL or both set; a pre-registered user who has never signed in has them NULL.
- **No RLS.** Authorization is applied by the backend. The `puede_escribir` / `puede_desactivar` / `puede_administrar` flags are **advisory metadata** — the database does not know which application user is acting, so nothing at the DB level stops an EDITOR from deactivating a record if the backend gets it wrong. This is a deliberate trade-off and contrasts with the heavy DB-level enforcement used for data integrity; the model is ready for RLS (`proyecto_id` is present everywhere) if that changes.
- **A project with `activo = 0` is ARCHIVED, not deleted.** Its access assignments are deactivated automatically, so nobody sees it through `vw_acceso_proyecto`. **Its engineering data is deliberately left untouched** — instruments, signals and routes stay `activo = 1`. There is no cascade from project deactivation into `nucleo` content.
- **`created_by` / `updated_by`** may be NULL, intentionally: migrations, bulk imports, pre-existing data and trigger-generated rows have no human author. For any change originating in an authenticated session, the backend must populate them.

## Commands

All commands run from `frontend/` (there is no root `package.json`):

```bash
cd frontend
npm install       # install dependencies
npm run dev       # start Vite dev server with HMR
npm run build     # type-check (tsc -b) then production build via Vite
npm run lint      # lint with oxlint
npm run preview   # preview the production build locally
```

There is no automated test runner for the frontend, and no backend yet. Database migrations and smoke tests are `.sql` files executed manually against SQL Server (in order: `001`, `002`, `003`, then `tests/001`–`017`) — there is no migration runner tool wired up yet.

## Current frontend implementation

- Build tool: Vite 8, using `@vitejs/plugin-react` (Babel-based Fast Refresh, not SWC).
- Language: TypeScript, project-references split into `tsconfig.app.json` (app code in `src/`, DOM lib) and `tsconfig.node.json` (`vite.config.ts`, Node lib). The root `tsconfig.json` just wires these two together via `references`.
- Entry point: `frontend/index.html` loads `src/main.tsx`, which mounts `<App />` from `src/App.tsx` into `#root` inside `React.StrictMode`.
- Linting: [oxlint](https://oxc.rs) (not ESLint), configured in `frontend/.oxlintrc.json` with the `react`, `typescript`, and `oxc` plugin sets. Type-aware lint rules are not currently enabled (would require `oxlint-tsgolint` and `"typeAware": true` in the config — see `frontend/README.md` if that's ever added).
- Static assets served as-is live in `frontend/public/` (e.g. `icons.svg`, referenced via `<use href="/icons.svg#...">`); bundled/imported assets live in `frontend/src/assets/`.
