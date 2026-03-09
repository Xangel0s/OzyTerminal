# Checklist Operativo de OzyTerminal

## Objetivo

Usar este checklist cuando el cliente Tauri falle al arrancar, cuando el frontend cambie de comportamiento sin motivo claro o cuando haya dudas sobre que cadena esta viva.

## 1. Verificar cadena activa

- El unico frontend activo debe ser `app-client/src-ui`.
- El backend de escritorio debe ser `app-client/src-tauri`.
- No deben existir frontends paralelos activos fuera de esa cadena.

## 2. Verificar package manager

- El cliente usa solo `npm`.
- Revisar `app-client/package.json`.
- Revisar `app-client/src-ui/package.json`.
- Confirmar que ambos tengan `packageManager: npm@11.6.2`.
- Confirmar que existan estos lockfiles:
  - `app-client/package-lock.json`
  - `app-client/src-ui/package-lock.json`
- Confirmar que no reaparezca `pnpm-lock.yaml` en `app-client/src-ui`.

## 3. Verificar scripts de arranque

- `app-client/scripts/ensure-next-dev.mjs` debe usar `npm --prefix src-ui run dev`.
- `app-client/src-tauri/tauri.conf.json` debe usar `npm --prefix src-ui run build` en `beforeBuildCommand`.
- `app-client/src-tauri/tauri.conf.json` debe apuntar a `http://127.0.0.1:3000` como `devUrl`.

## 4. Verificar puerto 3000

Si Tauri falla al iniciar:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
```

Si hay un proceso ocupandolo:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  Select-Object OwningProcess -First 1 |
  ForEach-Object { taskkill /F /PID $_.OwningProcess }
```

## 5. Verificar build del cliente

```powershell
Set-Location app-client
npm run build
```

Debe compilar `app-client/src-ui` con Next.js sin reintroducir Vite como build principal.

## 6. Verificar backend Rust

```powershell
Set-Location app-client/src-tauri
cargo check
```

## 7. Verificar arranque Tauri

```powershell
Set-Location app-client
npm run tauri:dev
```

## 8. Verificar SSH guardado

Si un host guardado vuelve a pedir credenciales:

- revisar si la entrada en vault tiene `password` o `privateKeyPem`
- revisar si una clave privada vieja invalida esta disparando fallback de auth
- revisar `activity-log.jsonl` para eventos `SSH session opening`, `SSH session error` y `Hosts updated`

## 9. Verificar SFTP/SSH tab state

Si la pestaña superior muestra un host equivocado:

- revisar propagacion de `sshSessionTitle`
- revisar propagacion de `sftpSessionTitle`
- revisar `app-client/src-ui/components/app-header.tsx`
- revisar `app-client/src-ui/components/main-content.tsx`

## 10. Regla de mantenimiento

Antes de tocar dependencias o scripts:

1. confirmar que el cambio afecta la cadena activa
2. no reintroducir `pnpm`
3. no crear otro frontend paralelo
4. validar con `npm run build` y `npm run tauri:dev`
