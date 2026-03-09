---
name: ozyterminal-ssh-tauri
description: Use this skill when debugging SSH session lifecycle, saved host reconnect behavior, SFTP/SSH header state, or Tauri-backed terminal flows in OzyTerminal.
---

# OzyTerminal SSH and Tauri Session Skill

## Use this skill for

- SSH saved-host reconnect issues
- password persistence problems
- private-key fallback problems
- SFTP and SSH header title propagation
- session persistence across view changes
- xterm and terminal lifecycle cleanup

## Core files

- `app-client/src-ui/components/ssh-connect-wizard.tsx`
- `app-client/src-ui/components/live-ssh-terminal.tsx`
- `app-client/src-ui/components/hosts-list.tsx`
- `app-client/src-ui/components/app-header.tsx`
- `app-client/src-ui/components/main-content.tsx`
- `app-client/src-ui/components/sftp-view.tsx`
- `app-client/src-ui/hooks/useSsh.ts`
- `app-client/src-ui/hooks/useServers.ts`
- `app-client/src-tauri/src/core/ssh_client.rs`
- `app-client/src-tauri/src/commands/session.rs`
- `app-client/src-tauri/src/commands/vault.rs`

## Validation flow

1. Confirm the saved host entry contains reusable auth material
2. Check whether the frontend preset contains `password` or `privateKeyPem`
3. Check backend auth order and fallback behavior
4. Check activity logs for `SSH session opening`, `SSH session error`, and `SSH session closed`
5. Validate `npm run build` and `cargo check`

## Guardrails

- Do not assume a UI freeze is a transport failure without logs
- Do not reintroduce double-dispose patterns in xterm addon cleanup
- Do not unmount the live SSH session unless the product behavior explicitly requires it
- Prefer fixing state propagation at the page or shared-layout level instead of patching around symptoms

## Known patterns in this repo

- saved-host presets must be consumed once and then cleared
- `sshSessionTitle` and `sftpSessionTitle` drive header labels
- invalid saved private keys can require fallback to password authentication
- local vault loading should remain SSR-safe and avoid hydration mismatches
