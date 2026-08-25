# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

SIEI = **Sistema Integrado de Entregables de Ingeniería**.

Goal: a modular web platform to manage engineering project information and to generate, control, and review deliverables ("entregables"). It must be designed to support **multiple projects**, not a single hardcoded one.

Initial domain focus is **Instrumentation & Control engineering**. Concepts likely to be part of the system (not a confirmed/final list): proyectos, equipos, instrumentos, señales, señales IO, señales de comunicaciones, RIO, racks, slots, módulos, canales, cables, lazos, documentos, entregables, revisiones.

**The data model, the modules, and the business rules are all still being discovered/defined.** Do not treat the entity list above as a finished schema, and do not treat its presence here as confirmation that any given entity, relationship, or rule is settled — it's the known domain vocabulary, not a spec. See "Working rules" below.

### Current repository state

Only the `frontend` package exists today (a Vite React+TS scaffold, still close to the template — see `src/App.tsx`). Backend and database do **not** exist yet and should not be created until explicitly requested.

## Planned architecture (full-stack)

- **Frontend**: React + TypeScript (this is what exists today, under `frontend/`).
- **Backend**: Node.js + TypeScript. Not yet created.
- **Database**: SQL Server / Azure SQL. Not yet created.

Hard constraints:
- The frontend must **never** connect directly to SQL Server. The backend is the **only** layer with database access.
- Keep frontend, backend, and database concerns separated (e.g. separate top-level packages/folders once backend and DB work begins).
- Prefer a modular, maintainable architecture — the platform is multi-project and multi-module by design, so avoid designs that assume a single project or hardcode Instrumentation & Control specifics where a general mechanism would do.
- SQL Server schema changes must go through migrations once the database exists — no ad hoc/manual schema edits.
- Use stable internal identifiers (surrogate keys) for entities. Do **not** use TAG (the engineering tag/label) as a database primary key.

## Working rules

- Don't invent engineering rules/business logic that haven't been confirmed by the user — this domain (I&C engineering) has real, project-specific conventions that must come from the user, not be assumed.
- When business information needed to proceed is missing, ask before assuming.
- Before significant structural changes (schema, module boundaries, cross-cutting architecture), explain the proposal and its impact before implementing.
- Never delete existing data or structures without explicit authorization.
- Document important architectural decisions as they're made (e.g. in this file or in dedicated docs — ask the user if unsure where).
- Don't implement significant features without first understanding the requirement — clarify scope/behavior with the user before building it.
- When there are multiple viable technical alternatives, present the options (with trade-offs) before picking one.

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

There is no test suite configured in this repository yet. There is no backend and no database yet, so there are no corresponding commands for those.

## Current frontend implementation

- Build tool: Vite 8, using `@vitejs/plugin-react` (Babel-based Fast Refresh, not SWC).
- Language: TypeScript, project-references split into `tsconfig.app.json` (app code in `src/`, DOM lib) and `tsconfig.node.json` (`vite.config.ts`, Node lib). The root `tsconfig.json` just wires these two together via `references`.
- Entry point: `frontend/index.html` loads `src/main.tsx`, which mounts `<App />` from `src/App.tsx` into `#root` inside `React.StrictMode`.
- Linting: [oxlint](https://oxc.rs) (not ESLint), configured in `frontend/.oxlintrc.json` with the `react`, `typescript`, and `oxc` plugin sets. Type-aware lint rules are not currently enabled (would require `oxlint-tsgolint` and `"typeAware": true` in the config — see `frontend/README.md` if that's ever added).
- Static assets served as-is live in `frontend/public/` (e.g. `icons.svg`, referenced via `<use href="/icons.svg#...">`); bundled/imported assets live in `frontend/src/assets/`.
