# src-ui Structure

`src-ui` is the only active frontend for OzyTerminal.

## Active runtime folders

- `app/`: Next.js App Router entrypoint, layouts, pages, and active global styles.
- `components/`: active UI and module components used by the desktop client.
- `hooks/`: active React hooks for SSH, SFTP, hosts, and UI state.
- `lib/`: shared client utilities and types.
- `public/`: static assets served by Next.js.
- `tests/`: Vitest setup and frontend unit tests.

## Non-runtime folder

- `legacy/`: archived frontend artifacts kept only for reference. These files are not part of the active app flow.

## Generated folders

- `.next/`: local Next.js development and build cache.
- `out/`: generated static/exported build output.
- `node_modules/`: installed frontend dependencies.

## Rules

- Keep new runtime code inside the active folders above.
- Put tests in `tests/`, not in a duplicate `src/` tree.
- Do not add alternative frontend roots under `src-ui`.
