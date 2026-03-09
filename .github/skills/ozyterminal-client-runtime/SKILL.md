---
name: ozyterminal-client-runtime
description: Use this skill when modifying, debugging, or validating the OzyTerminal desktop client startup path, package manager setup, build scripts, or frontend chain.
---

# OzyTerminal Client Runtime

## Use this skill for

- Tauri startup failures
- mixed `npm` and `pnpm` problems
- port `3000` conflicts
- frontend build chain validation
- package manager cleanup in `app-client`
- validating whether a change targets the real active frontend

## Source of truth

- Active frontend: `app-client/src-ui`
- Desktop backend: `app-client/src-tauri`
- Client package manager: `npm`

## Required validations

1. Check `app-client/package.json`
2. Check `app-client/src-ui/package.json`
3. Check `app-client/src-tauri/tauri.conf.json`
4. Check `app-client/scripts/ensure-next-dev.mjs`
5. Check for port `3000` conflicts before assuming app code is broken

## Expected commands

```powershell
Set-Location app-client
npm run build
npm run tauri:dev
```

```powershell
Set-Location app-client/src-tauri
cargo check
```

## Guardrails

- Do not add or switch to `pnpm`
- Do not create another frontend outside `app-client/src-ui`
- Do not treat legacy folders as active product code
- Prefer removing duplicated dependency wiring at the root cause

## Known failure patterns

- `beforeDevCommand` fails because the bootstrap script calls the wrong package manager
- Tauri fails because port `3000` is already in use
- performance degrades after mixed `node_modules` layouts appear
- old frontends or old lockfiles are reintroduced and confuse startup
