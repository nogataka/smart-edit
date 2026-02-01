# Repository Guidelines

## Project Structure & Module Organization
- `src/smart-edit` contains the agent runtime, CLI, and tools; extend features by colocating new modules with the subsystem they touch.
- `src/smartlsp` orchestrates language servers, while `src/interprompt` and `src/devtools` hold prompt authoring utilities; mirror this separation when adding code.
- Tests mirror the source layout in `test/**` (for example, `test/devtools/*.test.ts`), and long-form design notes live in `docs/`.

## Build, Test, and Development Commands
- `pnpm install` installs workspace dependencies (Node 20.11+); follow with `pnpm build` to run `tsc -p tsconfig.build.json` and copy resources into `dist/`.
- `pnpm test` executes Vitest; add `--coverage` for the V8 reports configured in `vitest.config.ts`.
- `pnpm lint` and `pnpm format:check` gate merges; run the fixing variants only after checking the diff, and use `SMART_EDIT_SKIP_RUNTIME_INSTALL=1 pnpm exec tsx src/smart-edit/cli.ts start-mcp-server ...` for fast CLI smoke tests.

## Coding Style & Naming Conventions
- Keep to the Prettier defaults in `prettier.config.cjs`: ES modules, 2-space indentation, single quotes, semicolons, and no trailing commas.
- Name files and symbols after their domain (`SmartEdit*` for agent concerns, `Solid*` for LSP helpers) and expose public APIs via `src/index.ts` only when stable.
- ESLint enforces consistent type imports, explicit member accessibility, and minimal unused variables; rely on helpers in `src/smart-edit/util/*` for shell access instead of ad hoc spawns.

## Testing Guidelines
- Place Vitest specs beside the mirrored module path with the `*.test.ts` suffix; the suite runs in the Node environment by default.
- Exercise success and failure paths, preferring fakes over subprocesses and using the utilities in `src/smart-edit/util` to stub file I/O.
- Run `pnpm test -- --coverage` before review and keep the file-level coverage trend flat or rising; document runtime-skipping assumptions via `SMART_EDIT_SKIP_RUNTIME_INSTALL=1`.

## Commit & Pull Request Guidelines
- Release bumps follow the existing `v0.0.x` convention; otherwise apply Conventional Commit prefixes (`feat:`, `fix:`, `refactor:`) and keep each commit atomic and lint-clean.
- Pull requests should describe the problem, solution, and validation commands, referencing paths such as `src/smart-edit/...` when scope is ambiguous.
- Request review only after local checks pass and capture outstanding follow-up items explicitly in the description.

## Security & Configuration Tips
- Store secrets in environment variables such as `SMART_EDIT_SKIP_RUNTIME_INSTALL`, `SMART_EDIT_ASSUME_<LANG>`, or `SMART_EDIT_<LANG>_PATH`; never commit them.
- Reuse helpers like `ensureDefaultSubprocessOptions` to enforce least privilege, and note new configuration toggles in `docs/` for operator awareness.
