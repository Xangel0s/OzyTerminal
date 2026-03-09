# Stack y Package Manager de OzyTerminal

## Cadena activa

El frontend activo del sistema es solo `app-client/src-ui`.

La cadena real de ejecucion es:

1. `app-client/package.json` orquesta Tauri.
2. `app-client/scripts/ensure-next-dev.mjs` levanta Next.js en `app-client/src-ui`.
3. `app-client/src-tauri/tauri.conf.json` apunta a `http://127.0.0.1:3000` en desarrollo y a `../src-ui/out` para build.
4. `app-client/src-tauri` contiene el backend Rust/Tauri.

## Gestor de paquetes valido

Usar solo `npm` en el cliente.

Rutas y lockfiles validos:

- `app-client/package-lock.json`
- `app-client/src-ui/package-lock.json`

Configuracion validada:

- `app-client/package.json` usa `packageManager: npm@11.6.2`
- `app-client/src-ui/package.json` usa `packageManager: npm@11.6.2`
- `app-client/src-tauri/tauri.conf.json` usa `npm --prefix src-ui run build`
- `app-client/scripts/ensure-next-dev.mjs` usa `npm --prefix src-ui run dev`

## No usar

No reintroducir `pnpm` en el flujo activo del cliente.

Motivo:

- mezcla lockfiles y layouts distintos en `node_modules`
- rompe `beforeDevCommand` y `beforeBuildCommand`
- deja residuos `.pnpm/` que complican reinstalacion y diagnostico
- aumenta el riesgo de que Tauri levante un frontend distinto al esperado

## Frontends eliminados del flujo

Estos frontends heredados se consideran fuera del sistema activo:

- `stitch/`
- `src-ui-old/`

Si reaparecen, deben tratarse como historicos o migrarse explicitamente. No deben participar en `tauri.conf.json`, scripts ni builds del cliente actual.

## Librerias activas del frontend

`app-client/src-ui/package.json` es la fuente de verdad para las librerias del frontend.

### Runtime base

- `next`
- `react`
- `react-dom`
- `@tauri-apps/api`

### Terminal SSH

- `@xterm/xterm`
- `@xterm/addon-fit`
- `@xterm/addon-webgl`

### UI y componentes

- familia `@radix-ui/*`
- `lucide-react`
- `react-icons`
- `class-variance-authority`
- `clsx`
- `tailwind-merge`
- `next-themes`
- `sonner`
- `vaul`
- `cmdk`
- `react-resizable-panels`

### Formularios y validacion

- `react-hook-form`
- `@hookform/resolvers`
- `zod`
- `input-otp`
- `react-day-picker`
- `date-fns`

### Visualizacion reutilizable

- `recharts`
- `embla-carousel-react`

### Tooling frontend

- `tailwindcss`
- `@tailwindcss/postcss`
- `postcss`
- `typescript`
- `vitest`
- `vite`
- `@vitejs/plugin-react`
- `jsdom`
- `@testing-library/react`
- `@testing-library/jest-dom`

## Comandos correctos

### Cliente

```powershell
Set-Location app-client
npm install
npm run build
npm run tauri:dev
```

### Frontend aislado

```powershell
Set-Location app-client/src-ui
npm install
npm run dev
npm run build
npm run test
```

## Regla operativa

Si hay un problema de arranque o rendimiento en el cliente, validar primero esto:

1. que no exista `pnpm-lock.yaml` en `app-client/src-ui`
2. que `tauri.conf.json` siga usando `npm`
3. que el unico frontend vivo sea `app-client/src-ui`
4. que no haya otro proceso ocupando `127.0.0.1:3000`
