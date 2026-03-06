OzyTerminal-Project/
├── app-client/
│   ├── src-tauri/
│   │   ├── Cargo.toml
│   │   ├── build.rs
│   │   └── src/
│   │       ├── main.rs
│   │       ├── app_state.rs
│   │       ├── commands/
│   │       │   ├── session.rs
│   │       │   └── vault.rs
│   │       ├── core/
│   │       │   ├── session_manager.rs
│   │       │   ├── ssh_client.rs
│   │       │   ├── pty.rs
│   │       │   └── zero_copy.rs
│   │       ├── crypto/
│   │       │   ├── envelope.rs
│   │       │   ├── keys.rs
│   │       │   └── memory_guard.rs
│   │       ├── tunnel/
│   │       │   ├── reverse_tunnel.rs
│   │       │   └── relay_client.rs
│   │       └── collab/
│   │           ├── shared_vault.rs
│   │           └── session_mirror.rs
│   └── src-ui/
│       ├── components/
│       │   └── TerminalView.tsx
│       ├── hooks/
│       │   └── useTerminalSession.ts
│       ├── store/
│       │   └── sessionStore.ts
│       └── types/
│           └── api.ts
├── control-plane/
│   └── src/
│       ├── auth/
│       ├── ca/
│       ├── relay/
│       ├── synchronization/
│       └── audit/
└── agent-node/
    └── src/
        ├── main.rs
        ├── reverse_ssh.rs
        └── health.rs