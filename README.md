# OzyTerminal

OzyTerminal is a Tauri-based SSH workstation with three explicit goals:

1. Open hardened interactive SSH sessions from a desktop client.
2. Issue short-lived OpenSSH certificates from a control-plane with a real CA.
3. Reach nodes behind CGNAT through an outbound `agent-node` and a relay.

This repository is not a static mock anymore. It already contains a working baseline for the critical path: local vault, SSH, host-key verification, ephemeral certs, relay leases, reverse connectivity, shared vault listing, and read-only session mirroring.

## What Works Today

- Clean workspace build with `cargo check`
- Tauri client build with `npm run build`
- Real `russh` SSH connection with host-key verification
- Local encrypted vault with password rotation
- Control-plane CA backed by a persisted Ed25519 signer
- Short-lived relay leases with `target_node_id` claim flow
- `agent-node` registration plus reverse proxy to local SSH
- Shared vault persisted on disk with effective ACL resolution
- Read-only session mirror for authorized viewers
- Collaboration audit trail persisted as JSONL

## Architecture

### `app-client`

The desktop client owns the operator workflow:

- collects connection data
- validates the server host key
- unlocks the local vault
- requests SSH certs or relay leases from the control-plane
- opens the interactive terminal
- exposes a shared vault demo flow and a mirror viewer

Key pieces:

- `app-client/src-tauri`: Rust backend, SSH, crypto, Tauri commands
- `app-client/src-ui`: React UI, terminal, vault, relay, mirror, shared vault views

### `control-plane`

The control-plane owns trust and coordination:

- persists the OpenSSH CA
- issues short-lived SSH certificates
- authenticates API calls with an optional bearer token
- registers `agent-node` heartbeats
- creates and claims relay leases
- relays TCP streams between client and agent
- appends audit records for certificate issuance

### `agent-node`

The agent is the outbound foothold for private infrastructure:

- registers itself periodically
- polls for pending leases addressed to its `node_id`
- connects to the relay
- forwards traffic to the local SSH daemon or another requested port

## Demo Flow

The current happy path is:

1. Start `control-plane`.
2. Start `agent-node` on the target machine.
3. Open `app-client`.
4. Load or save a local encrypted vault entry.
5. Issue a short-lived SSH cert if needed.
6. If the host is behind CGNAT, set `Target Node` and let the client resolve the relay lease.
7. Connect to the terminal.
8. Share the active session with a viewer and inspect the mirror read-only.
9. Bootstrap the demo shared vault and resolve effective ACL by actor.

## Quick Start

### 1. Install dependencies

You need:

- Rust stable
- Node.js + npm
- Tauri prerequisites
- Windows MSVC Build Tools if you are on Windows

### 2. Build the workspace

```powershell
cargo check
cd app-client
npm install
npm run build
```

### 3. Run the control-plane

```powershell
$env:OZY_CONTROL_PLANE_LISTEN="127.0.0.1:8080"
$env:OZY_RELAY_LISTEN="127.0.0.1:9443"
cargo run -p ozyterminal-control-plane
```

### 4. Run an agent

```powershell
$env:OZY_CONTROL_PLANE_URL="http://127.0.0.1:8080"
$env:OZY_AGENT_NODE_ID="staging-node-1"
$env:OZY_AGENT_UPSTREAM_HOST="127.0.0.1"
cargo run -p ozyterminal-agent-node
```

### 5. Run the client

```powershell
cd app-client
npm run tauri dev
```

### 6. Or use the demo helper script

```powershell
.\scripts\demo-stack.ps1 -Role control-plane
.\scripts\demo-stack.ps1 -Role agent -NodeId demo-node-1
.\scripts\demo-stack.ps1 -Role client
```

## Collaboration Baseline

### Shared Vault

The shared vault is stored locally as JSON and currently provides:

- persisted document state
- optimistic version bump on save
- revision log appends
- path-based ACL resolution with allow/deny rules
- server listing filtered by effective permissions
- server upsert/delete flow from the UI
- demo bootstrap from the UI

### Session Mirror

The session mirror currently provides:

- owner registration when a session starts
- transcript capture from live SSH output
- explicit viewer/editor sharing
- read-only mirror snapshots for authorized actors
- mirror listing in the UI
- collaboration audit entries for share/view actions

This is intentionally a baseline. It proves the product flow without pretending the collaboration plane is fully hardened yet.

### Collaboration Audit

The app also writes a local collaboration audit log for:

- shared vault saves and bootstrap
- shared vault node upsert/delete actions
- session mirror share actions
- session mirror read access

The current store is JSONL so it stays easy to inspect and automate against.

## Important Environment Variables

### Control-plane

- `OZY_CONTROL_PLANE_LISTEN`
- `OZY_CONTROL_PLANE_ACCESS_TOKEN`
- `OZY_CONTROL_PLANE_STATE_DIR`
- `OZY_RELAY_LISTEN`
- `OZY_RELAY_PUBLIC_ADDRESS`
- `OZY_RELAY_NODE_TTL_SECONDS`

### Agent-node

- `OZY_CONTROL_PLANE_URL`
- `OZY_CONTROL_PLANE_ACCESS_TOKEN`
- `OZY_AGENT_NODE_ID`
- `OZY_AGENT_RELAY_PURPOSE`
- `OZY_AGENT_UPSTREAM_HOST`
- `OZY_AGENT_REGISTRATION_TTL_SECONDS`
- `OZY_AGENT_CLAIM_POLL_SECONDS`

## Validation

These commands are part of the current validation baseline:

```powershell
cargo check
cargo test -p ozyterminal-control-plane
cargo test -p ozyterminal-app --lib
cd app-client
npm run build
```

## Roadmap Snapshot

As of 2026-03-07:

- Fase 0 a Fase 5: baseline funcional cerrada
- Fase 6: baseline funcional cerrada
- Fase 7: parcial, falta endurecimiento y demo empaquetada de forma mas pulida

## Repository Map

```text
app-client/      Desktop app (Tauri + React + russh)
control-plane/   CA, relay, lease orchestration, audit
agent-node/      Reverse connector for CGNAT/private nodes
Ozyterminal.md   Product architecture and phased roadmap
```

## Current Limits

The next engineering layer is not "make SSH work". That part already works.

The next layer is:

- richer shared-vault editing UX
- better mirror observability and retention
- packaging the end-to-end demo as a repeatable operator flow
- hardening auth, policy, and identity around collaboration
