# Docs del Repositorio

## Codigo activo

- `app-client/`: cliente de escritorio Tauri + frontend Next.js en `src-ui`
- `control-plane/`: CA, relay y coordinacion
- `agent-node/`: conector saliente para nodos privados

## Documentacion tecnica

- `README.md`: vista general del producto y quick start
- `docs/architecture/`: arquitectura y estructura tecnica del proyecto
- `docs/operations/`: stack activo, package manager y checklists operativos

## Material de apoyo

- `docs/design-assets/`: imagenes, prototipos HTML y material visual de referencia

## Regla de orden

Todo lo que no sea codigo ejecutable o script operativo debe vivir en `docs/` o debajo de `docs/design-assets/`.
El unico frontend activo del sistema vive en `app-client/src-ui`.
