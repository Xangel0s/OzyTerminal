# OzyTerminal Repo Instructions

- Use only `npm` for the client toolchain.
- The only active frontend is `app-client/src-ui`.
- Do not reintroduce `pnpm` into `app-client`, `app-client/src-ui`, Tauri config, or dev bootstrap scripts.
- Treat `app-client/src-tauri` as the desktop backend and `app-client/src-ui` as the only UI entrypoint.
- Before changing startup or dependency wiring, verify `app-client/src-tauri/tauri.conf.json` and `app-client/scripts/ensure-next-dev.mjs` remain aligned.
- Prefer validating client changes with `Set-Location app-client; npm run build` and desktop startup with `Set-Location app-client; npm run tauri:dev`.
- For SSH/session issues, inspect both frontend state propagation and backend activity logs before changing auth logic.
