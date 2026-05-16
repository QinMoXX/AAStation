# Repository Guidelines

## Project Overview

AAStation is a **Tauri 2 desktop app** for visually building AI API routing pipelines. Users drag-drop nodes on a canvas to define request flows (Application → Switcher → Poller → Provider), then run a local Axum proxy server.

## Architecture

- **Frontend**: React 19 + Vite 7 + TypeScript + Tailwind CSS 4 + Zustand 5 + React Flow
- **Backend**: Rust + Tauri 2 + Axum + Tokio
- **State**: Zustand stores only (no React Context). Key stores: `flow-store.ts` (canvas state + DAG CRUD), `app-store.ts` (proxy status), `settings-store.ts` (persistent settings)
- **Persistence**: DAG auto-saves via 500ms debounced IPC. Ctrl+S triggers immediate save.
- **Custom window**: `decorations: false` — app uses its own TitleBar component. Dark theme only.

## Build & Development Commands

```bash
npm run dev          # Vite dev server on :1420 (frontend only, HMR on :1421)
npm run build        # tsc + vite build (type-check + bundle)
npm run tauri dev    # Full Tauri dev (frontend + Rust backend with hot-reload)
npm run tauri build  # Production build (output in src-tauri/target/release/bundle/)
npm run preview      # Vite preview server
npm run bump -- X.Y.Z  # Sync version across package.json, tauri.conf.json, Cargo.toml, README badge
```

- **No test framework** configured (no vitest/jest).
- **No linter/formatter** (no ESLint/Prettier) — follow existing code style.
- TypeScript strict mode is on but `noUnusedLocals`/`noUnusedParameters` are disabled.
- Run `npm run build` before PRs to verify type-check + bundle.

## Code Layout

```
src/                          # Frontend
  store/                      # Zustand stores (index.ts re-exports all)
  types/                      # TypeScript types (nodes.ts, dag.ts, proxy.ts, settings.ts)
  hooks/                      # useDagSync.ts, useProxyStatus.ts
  components/
    canvas/                   # FlowCanvas (ReactFlow), CanvasToolbar
    nodes/                    # ProviderNode, SwitcherNode, PollerNode, ApplicationNode + NodePanel
    layout/                   # AppLayout, TitleBar, Header, SidebarNav, StatusBar
    pages/                    # MonitorPage, SettingsPage
    ui/                       # shadcn/ui-style primitives
  lib/
    tauri-api.ts              # All Tauri IPC wrappers (typed invoke() calls)
    dag-utils.ts              # Frontend ↔ Backend DAG conversion (camelCase ↔ snake_case)
    edge-rules.ts             # Edge connection validation rules
    utils.ts                  # cn() helper (clsx + tailwind-merge)
  data/                       # Static presets (provider-presets.json, switcher-defaults.json, etc.)

src-tauri/                    # Rust backend
  src/
    lib.rs                    # Tauri app setup, command registration, tray, shutdown
    commands/                 # Tauri #[command] handlers (dag_, proxy_, settings_, app_, log_, etc.)
    dag/                      # DAG types, compilation, validation
    proxy/                    # Axum proxy server (server.rs, handler.rs, workflow.rs, health.rs, etc.)
    store.rs                  # Shared app state (Arc<RwLock<...>>)
    settings.rs               # Settings persistence
    dag_store.rs              # DAG file persistence
    claude_config.rs          # Claude Code config management
    opencode_config.rs        # OpenCode config management
    codex_config.rs           # Codex CLI config management

scripts/
  bump-version.mjs            # Version bump script (syncs 4 files)
```

## Key Technical Decisions

- **DAG serialization**: `dag-utils.ts` handles camelCase ↔ snake_case conversion between React Flow and Rust backend
- **Edge validation**: `edge-rules.ts` enforces topology constraints (app → switcher/poller/provider, no provider chaining)
- **Proxy polling**: `useProxyStatus` polls every 2s; `MonitorPage` polls metrics every 4s
- **Config management**: Rust backend writes/reads/backups Claude Code, OpenCode, Codex CLI configs
- **Code splitting**: Vite splits `@lobehub/icons`, `reactflow`, `@tauri-apps` into separate vendor chunks
- **Floating window**: `floating.html` entry point for floating window feature

## Coding Style & Naming Conventions

- **Imports**: Third-party first, then `@/...` absolute imports, then relative imports
- **Components**: Default exports, named exports for internal helpers
- **CSS**: Tailwind v4 with `@theme` custom variables in `index.css`, `flow-node-*` classes for ReactFlow nodes
- **File naming**: PascalCase for components, camelCase for utilities/hooks
- **Path alias**: `@/` → `src/` (configured in tsconfig.json and vite.config.ts)

## DAG Routing Pipeline

```
Application → Switcher → Poller → Provider
```

| Node Type | Role |
|-----------|------|
| **Application** | Listens on dedicated port; emits requests into pipeline |
| **Switcher** | Routes by model name, path prefix, or HTTP header |
| **Poller** | Selects among targets using weighted/health-first/token-remaining strategies |
| **Provider** | AI service endpoint (OpenAI/Anthropic-compatible) |

## Version Bump Process

`npm run bump -- X.Y.Z` syncs version across 4 files:
1. `package.json` + `package-lock.json`
2. `src-tauri/tauri.conf.json`
3. `src-tauri/Cargo.toml`
4. `README.md` badge

CI workflow (`.github/workflows/release.yml`) triggers on version tags, runs bump, then builds for Windows and Linux.

## Security & Configuration Tips

- Do not commit API keys, provider tokens, or local proxy credentials
- Keep provider presets generic in `src/data/`
- Route all filesystem/process access through typed Tauri IPC wrappers in `src/lib/tauri-api.ts`
