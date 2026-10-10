# Agent Guidance: report-drawer

A Vue 3 + TypeScript + Vite application for filling out Tianjin Normal University lab reports as rendered PDFs. Handles user data locally via Cookies and localStorage.

## Core Stack & Conventions

- **TypeScript**: strict mode enabled (`"strict": true` in `tsconfig.json`)
- **Vue 3**: Composition API with `<script setup>`
- **Pinia**: Global state management (`src/stores/reports.ts`)
- **Vue Router 4**: Hash-free history mode (`createWebHistory`)
- **Vite 6**: `defineConfig` with `@` alias to `./src`

## Repository Structure

```
.
├── src/                    # Source code (non-public)
│   ├── assets/             # Static assets (main.css)
│   ├── components/         # Vue components (PageEditor.vue)
│   ├── lib/                # Core utilities:
│   │   ├── cookie.ts       # Cookie-based profile storage
│   │   ├── exporter.ts     # Canvas PDF rendering & PNG export
│   │   ├── formTemplate.ts # A3 page layout definitions (841.92×1190.52 pt)
│   │   └── textLayout.ts   # Text wrapping & pagination logic
│   ├── router/             # Vue Router instance
│   ├── stores/             # Pinia stores (reports.ts)
│   ├── types/              # Shared TypeScript interfaces
│   ├── views/              # Page views (ReportListView, ReportEditView)
│   ├── App.vue             # Root component
│   └── main.ts             # App entry (mounts to #app)
├── public/                 # Public assets copied verbatim (bg_page1.png, bg_page2.png)
├── dist/                   # Built output (ignored)
└── node_modules/           # Dependencies (ignored)
```

- `@/` alias points to `src/`
- Background images live in `public/` and are referenced relative (`bg_page1.png`)
- Report data is stored in `localStorage` under key `report-drawer:reports:v1`

## Verification Commands

Run these directly from repository root.

**Development**
```bash
pnpm dev
```
Starts Vite dev server on `http://localhost:5173` (no auto-open).

**Type checking**
```bash
vue-tsc --noEmit
```
Ensures TypeScript compilation succeeds with current config.

**Production build**
```bash
pnpm build
```
Compiles with `vue-tsc` then bundles with Vite. Output goes to `dist/`.

**Preview build**
```bash
pnpm preview
```
Serves the `dist/` folder at `http://localhost:4173`.

## Key Areas

### UI & Rendering
- Backgrounds: 2 A3 pages. Field positions are defined in PDF points in `formTemplate.ts`.
- Canvas rendering occurs in `exporter.ts`. Use `exportPage()` with `bodyUrl: "./bg_pageX.png"` and `formTemplate`.
- Text wraps/overflows handling in `textLayout.ts`. First-page content maxes at 22 lines before continuing to page 2.

### Data Storage
- Profile fields (`className`, `name`, `studentId`, `teammates`) are persisted in Cookies via `setCookie()/getCookie()`.
- Reports are stored in `localStorage` as JSON, key `report-drawer:reports:v1`.
- On field change to profile fields, user profile is saved via `saveUserProfile()`.

### Security
- Data remains entirely client-side; no network requests or external APIs.
- Do not add or modify code that sends data externally (there are none).
- Existing `@/lib/cookie.ts` is safe as-is. It uses `SameSite=Lax` and standard encode/decode.

### Generated Files
- `dist/` – build artifacts, never edit. Rebuild to update.
- `node_modules/` – dependencies, do not commit.

## Failure Modes

1. **Canvas fails** – Background image may be unavailable or CORS-misconfigured. Ensure images are public assets.
2. **Empty reports** – Check localStorage `report-drawer:reports:v1`. If present but invalid, store is ignored.
3. **Type errors** – Profiling uses `@/lib/cookie.ts`. Ensure shapes match `UserProfile` and profile fields.
4. **Build error** – `vue-tsc` runs before `vite build`. Fix TS errors first.

## Completion Criteria

For any change:
- `pnpm build` completes successfully
- All TypeScript noEmit passes (implied by build)
- Build output can be served via `pnpm preview` and functions correctly

## Security & Trust Constraints

- Treat `src/lib/cookie.ts` and `src/stores/reports.ts` as **trusted core logic**; they handle data persistence.
- Do not introduce network code. There is none.
- Docker/pnpm: if using a minimal container, ensure it copies `node_modules` (not dev files) to build and runs `pnpm build`.

## Useful Tooling

- TypeScript: `tsc` (also in `vue-tsc`) and `@types/node` implicitly used via `tsconfig.node.json`.
- Vite: `vite.config.ts` defines `@` alias and dev server port `5173`.
- Pi's `codemode` tool can run JS scripts that invoke other tools.
