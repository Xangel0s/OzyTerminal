# OzyTerminal Core

Diseno del nucleo de una terminal colaborativa basada en Tauri, Rust y TypeScript. El objetivo es mantener una app de escritorio con baja huella de memoria, sesiones SSH concurrentes y una capa de colaboracion segura.

## 1. Arquitectura de alto nivel

### Objetivos

- Multiplexar cientos de sesiones SSH con `tokio` sin bloquear la UI.
- Usar `russh` para SSH nativo, soporte de llaves Ed25519 y certificados efimeros firmados por una CA.
- Transportar datos terminal <-> backend via channels de Tauri, evitando polling e intermediarios innecesarios.
- Mantener buffers de terminal en memoria con `bytes::Bytes` y `BytesMut` para reducir copias.
- Habilitar colaboracion y vaults compartidos con herencia de permisos por carpeta.
- Soportar escenarios detras de CGNAT mediante tuneles reversos hacia un relay/control-plane.

### Capas

1. `src-tauri/src/core`
	 Cliente SSH, lifecycle de sesiones, PTY virtual, multiplexacion y backpressure.

2. `src-tauri/src/crypto`
	 Generacion Ed25519, derivacion Argon2id, cifrado AES-256-GCM, manejo de secretos en memoria.

3. `src-tauri/src/tunnel`
	 Tuneles reversos SSH y relay saliente para hosts detras de CGNAT.

4. `src-tauri/src/collab`
	 Shared Vault, resolucion de permisos, mirroring de sesiones y eventos auditables.

5. `src-ui`
	 React + xterm.js + store de sesiones. No interpreta SSH; solo renderiza frames y emite input.

## 2. Estructura sugerida

```text
OzyTerminal-Project/
├── app-client/
│   ├── src-tauri/
│   │   ├── Cargo.toml
│   │   ├── build.rs
│   │   └── src/
│   │       ├── main.rs
│   │       ├── app_state.rs
│   │       ├── commands/
│   │       │   ├── mod.rs
│   │       │   ├── session.rs
│   │       │   └── vault.rs
│   │       ├── core/
│   │       │   ├── mod.rs
│   │       │   ├── session_manager.rs
│   │       │   ├── ssh_client.rs
│   │       │   ├── pty.rs
│   │       │   └── zero_copy.rs
│   │       ├── crypto/
│   │       │   ├── mod.rs
│   │       │   ├── envelope.rs
│   │       │   ├── keys.rs
│   │       │   └── memory_guard.rs
│   │       ├── tunnel/
│   │       │   ├── mod.rs
│   │       │   ├── reverse_tunnel.rs
│   │       │   └── relay_client.rs
│   │       └── collab/
│   │           ├── mod.rs
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
```

## 3. Backend Rust: Cargo.toml base

```toml
[package]
name = "ozyterminal-core"
version = "0.1.0"
edition = "2021"

[dependencies]
anyhow = "1"
argon2 = { version = "0.5", features = ["std"] }
aes-gcm = "0.10"
async-trait = "0.1"
base64 = "0.22"
bytes = "1"
chacha20poly1305 = "0.10"
ed25519-dalek = { version = "2", features = ["rand_core", "pkcs8"] }
parking_lot = "0.12"
rand = "0.8"
russh = "0.50"
russh-keys = "0.50"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
secrecy = "0.8"
tauri = { version = "2", features = [] }
thiserror = "2"
tokio = { version = "1", features = ["full"] }
tokio-stream = "0.1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
uuid = { version = "1", features = ["v4", "serde"] }
zeroize = "1"

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

Notas:

- `bytes` permite slices compartidos y reuso de buffers sin copiar payloads de terminal entre tareas.
- `parking_lot` reduce overhead frente a `std::sync` en rutas calientes del estado local.
- `secrecy` y `zeroize` ayudan a minimizar exposicion de secretos en memoria.
- `chacha20poly1305` no es obligatorio para el requerimiento, pero es util si quieres separar cifrado de transporte interno del vault local.

## 4. Modelo de ejecucion asincrona

Cada sesion vive como un conjunto de tareas coordinadas por `tokio`:

1. Tarea de conexion SSH.
2. Tarea de lectura desde el canal SSH.
3. Tarea de escritura hacia el canal SSH.
4. Tarea de puente Tauri Channel -> SSH.
5. Tarea opcional de mirroring para espectadores/colaboradores.

### Principios de performance

- No usar un `String` intermedio para bytes de terminal.
- Mantener frames como `Bytes` hasta el ultimo punto de serializacion IPC.
- Aplicar backpressure con `tokio::sync::mpsc` acotado.
- Reutilizar `BytesMut` para ensamblar frames de salida cuando el protocolo llegue fragmentado.
- Mantener resize, heartbeat y input en canales separados del stream principal cuando haga falta priorizacion.

## 5. Estado global de la app

```rust
use std::{collections::HashMap, sync::Arc};

use parking_lot::RwLock;
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
		pub sessions: Arc<RwLock<HashMap<Uuid, SessionHandle>>>,
}

pub struct SessionHandle {
		pub input_tx: mpsc::Sender<TerminalInput>,
		pub event_tx: broadcast::Sender<TerminalEvent>,
}

#[derive(Debug)]
pub enum TerminalInput {
		Stdin(bytes::Bytes),
		Resize { cols: u16, rows: u16 },
		Close,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TerminalEvent {
		Connected { session_id: Uuid },
		Stdout { chunk_b64: String },
		Closed { reason: String },
		Error { message: String },
}
```

La conversion a Base64 ocurre solo al cruzar el boundary IPC si el channel requiere payload serializable. Internamente, el buffer sigue siendo `Bytes`.

## 6. SSH con russh: cliente y autenticacion

### Estrategia de autenticacion

Se soportan dos caminos:

1. Llave Ed25519 local.
2. Certificado efimero firmado por una CA de usuario/equipo con TTL corto, por ejemplo 8 horas.

Flujo recomendado:

1. El usuario autentica contra el control-plane.
2. La app genera o desbloquea una llave Ed25519 local.
3. La app solicita un certificado SSH efimero para esa clave publica.
4. El control-plane firma con la CA y devuelve certificado + principals + expiracion.
5. `russh` usa la private key y presenta el certificado en la fase de auth.

### Tipos de configuracion

```rust
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshSessionRequest {
		pub host: String,
		pub port: u16,
		pub username: String,
		pub private_key_pem: String,
		pub certificate_pem: Option<String>,
		pub known_host_fingerprint: Option<String>,
		pub cols: u32,
		pub rows: u32,
		pub relay_hint: Option<RelayHint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelayHint {
		pub relay_url: String,
		pub token: SecretString,
		pub target_node_id: String,
}
```

### Esqueleto del cliente SSH

```rust
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use bytes::{Bytes, BytesMut};
use russh::client::{self, Config as ClientConfig, Handle};
use russh::{Channel, ChannelId};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};
use tracing::{error, info};

pub struct OzyClient {
		pub events: broadcast::Sender<TerminalEvent>,
}

pub struct SessionRuntime {
		pub handle: Handle<OzyClient>,
		pub channel: Channel<client::Msg>,
}

#[async_trait]
impl client::Handler for OzyClient {
		type Error = anyhow::Error;

		async fn check_server_key(
				&mut self,
				server_public_key: &russh_keys::key::PublicKey,
		) -> Result<bool, Self::Error> {
				let _ = server_public_key;
				Ok(true)
		}

		async fn data(
				&mut self,
				_channel: ChannelId,
				data: &[u8],
				_session: &mut client::Session,
		) -> Result<(), Self::Error> {
				let chunk = Bytes::copy_from_slice(data);
				let event = TerminalEvent::Stdout {
						chunk_b64: base64::encode(chunk),
				};
				let _ = self.events.send(event);
				Ok(())
		}
}

pub async fn connect_ssh(
		request: SshSessionRequest,
		input_rx: mpsc::Receiver<TerminalInput>,
		event_tx: broadcast::Sender<TerminalEvent>,
) -> Result<()> {
		let config = Arc::new(ClientConfig::default());
		let ssh_handler = OzyClient {
				events: event_tx.clone(),
		};

		let tcp_stream = if let Some(relay) = &request.relay_hint {
				connect_via_relay(&request, relay).await?
		} else {
				tokio::net::TcpStream::connect((&*request.host, request.port)).await?
		};

		let mut client = client::connect_stream(config, tcp_stream, ssh_handler).await?;
		let key_pair = load_ed25519_keypair(&request.private_key_pem)?;

		if let Some(cert_pem) = &request.certificate_pem {
				let cert = load_openssh_certificate(cert_pem)?;
				client
						.authenticate_publickey_with_cert(request.username.clone(), Arc::new(key_pair), cert)
						.await?;
		} else {
				client
						.authenticate_publickey(request.username.clone(), Arc::new(key_pair))
						.await?;
		}

		if !client.is_authenticated() {
				return Err(anyhow!("ssh authentication failed"));
		}

		let mut channel = client.channel_open_session().await?;
		channel
				.request_pty(true, "xterm-256color", request.cols, request.rows, 0, 0, &[])
				.await?;
		channel.request_shell(true).await?;

		let _ = event_tx.send(TerminalEvent::Connected {
				session_id: uuid::Uuid::new_v4(),
		});

		spawn_input_pump(channel.id(), input_rx, client.handle(), event_tx.clone());

		let mut assemble = BytesMut::with_capacity(64 * 1024);
		while let Some(msg) = channel.wait().await {
				match msg {
						russh::ChannelMsg::Data { data } => {
								assemble.extend_from_slice(data.as_ref());
								if !assemble.is_empty() {
										let frame = assemble.split().freeze();
										let _ = event_tx.send(TerminalEvent::Stdout {
												chunk_b64: base64::encode(frame),
										});
								}
						}
						russh::ChannelMsg::Close => {
								let _ = event_tx.send(TerminalEvent::Closed {
										reason: "remote closed channel".into(),
								});
								break;
						}
						_ => {}
				}
		}

		Ok(())
}

fn spawn_input_pump(
		channel_id: ChannelId,
		mut input_rx: mpsc::Receiver<TerminalInput>,
		handle: Handle<OzyClient>,
		event_tx: broadcast::Sender<TerminalEvent>,
) {
		tokio::spawn(async move {
				while let Some(input) = input_rx.recv().await {
						let result = match input {
								TerminalInput::Stdin(chunk) => handle.data(channel_id, chunk).await,
								TerminalInput::Resize { cols, rows } => {
										handle.window_change(channel_id, cols as u32, rows as u32, 0, 0).await
								}
								TerminalInput::Close => handle.close(channel_id).await,
						};

						if let Err(err) = result {
								error!(?err, "terminal input pump failed");
								let _ = event_tx.send(TerminalEvent::Error {
										message: err.to_string(),
								});
								break;
						}
				}
				info!("terminal input pump stopped");
		});
}
```

### Notas de implementacion

- Si `russh` no expone exactamente `authenticate_publickey_with_cert` en tu version, encapsula la construccion del signer/certificado en un adaptador propio. El punto de arquitectura es que la identidad base es Ed25519 y el certificado efimero se adjunta sobre esa clave.
- `check_server_key` no debe quedarse en `Ok(true)` en produccion. Debe validar `known_hosts`, pinning o fingerprints almacenados en el vault.
- Los chunks de salida se mantienen como bytes hasta el ultimo borde posible. Si quieres eliminar Base64, mueve el stream de terminal a plugin nativo o sidecar IPC binario.

## 7. Tuneles reversos para saltar CGNAT

Hay dos escenarios distintos y conviene soportar ambos.

### A. Cliente de escritorio alcanza un host remoto detras de CGNAT

1. Un `agent-node` corre en el host remoto o en su gateway.
2. El `agent-node` abre una conexion saliente hacia el relay del control-plane.
3. El relay asigna un `node_id` y mantiene un socket persistente.
4. Cuando el cliente quiere conectarse, solicita al relay una ruta al `node_id`.
5. El trafico SSH real viaja encapsulado por ese socket saliente ya establecido.

Este enfoque evita depender de apertura de puertos entrantes y funciona incluso bajo NAT carrier-grade.

### B. Reverse port forwarding SSH clasico

Si el host remoto ya expone SSH saliente, puedes pedir `tcpip-forward` hacia el relay:

```rust
pub async fn establish_reverse_forward(
		handle: &russh::client::Handle<OzyClient>,
		bind_host: &str,
		bind_port: u32,
) -> anyhow::Result<()> {
		handle.tcpip_forward(bind_host, bind_port).await?;
		Ok(())
}
```

Recomendacion de arquitectura:

- Usa relay propio sobre `tokio` para el caso general CGNAT.
- Usa `tcpip-forward` como optimizacion/compatibilidad cuando el peer soporte reverse SSH estandar.
- Toda ruta relay debe autenticarse con token corto + attestation del nodo + rotacion automatica.

## 8. main.rs en Tauri

El backend debe exponer comandos finos y mantener los streams por `Channel`, no por `invoke` repetido.

```rust
mod app_state;
mod commands;
mod collab;
mod core;
mod crypto;
mod tunnel;

use app_state::AppState;
use parking_lot::RwLock;
use std::{collections::HashMap, sync::Arc};

fn main() {
		tracing_subscriber::fmt()
				.with_env_filter("info")
				.init();

		tauri::Builder::default()
				.manage(AppState {
						sessions: Arc::new(RwLock::new(HashMap::new())),
				})
				.invoke_handler(tauri::generate_handler![
						commands::session::open_session,
						commands::session::send_input,
						commands::session::resize_session,
						commands::session::close_session,
						commands::vault::encrypt_secret,
				])
				.run(tauri::generate_context!())
				.expect("failed to run tauri app");
}
```

### Comando de apertura con channel de eventos

```rust
use bytes::Bytes;
use tauri::{ipc::Channel, State};
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

#[tauri::command]
pub async fn open_session(
		state: State<'_, AppState>,
		request: SshSessionRequest,
		events: Channel<TerminalEvent>,
) -> Result<String, String> {
		let session_id = Uuid::new_v4();
		let (input_tx, input_rx) = mpsc::channel(512);
		let (event_tx, _) = broadcast::channel(512);

		state.sessions.write().insert(
				session_id,
				SessionHandle {
						input_tx: input_tx.clone(),
						event_tx: event_tx.clone(),
				},
		);

		let mut event_rx = event_tx.subscribe();
		tokio::spawn(async move {
				while let Ok(event) = event_rx.recv().await {
						let _ = events.send(event);
				}
		});

		tokio::spawn(async move {
				if let Err(err) = connect_ssh(request, input_rx, event_tx.clone()).await {
						let _ = event_tx.send(TerminalEvent::Error {
								message: err.to_string(),
						});
				}
		});

		Ok(session_id.to_string())
}

#[tauri::command]
pub async fn send_input(
		state: State<'_, AppState>,
		session_id: String,
		data_b64: String,
) -> Result<(), String> {
		let session_id = uuid::Uuid::parse_str(&session_id).map_err(|e| e.to_string())?;
		let data = base64::decode(data_b64).map_err(|e| e.to_string())?;
		let chunk = Bytes::from(data);

		let input_tx = state
				.sessions
				.read()
				.get(&session_id)
				.ok_or_else(|| "session not found".to_string())?
				.input_tx
				.clone();

		input_tx
				.send(TerminalInput::Stdin(chunk))
				.await
				.map_err(|e| e.to_string())
}
```

## 9. Frontend TypeScript: xterm.js + Tauri channels

El frontend no debe modelar el stream como estado React. Debe escribir directo en `xterm` para evitar rerenders por cada chunk.

```tsx
import { useEffect, useRef } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

type TerminalEvent =
	| { type: 'connected'; session_id: string }
	| { type: 'stdout'; chunk_b64: string }
	| { type: 'closed'; reason: string }
	| { type: 'error'; message: string };

type SshSessionRequest = {
	host: string;
	port: number;
	username: string;
	privateKeyPem: string;
	certificatePem?: string;
	cols: number;
	rows: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(input: Uint8Array): string {
	let binary = '';
	input.forEach((value) => {
		binary += String.fromCharCode(value);
	});
	return btoa(binary);
}

function base64ToBytes(input: string): Uint8Array {
	const raw = atob(input);
	const bytes = new Uint8Array(raw.length);
	for (let index = 0; index < raw.length; index += 1) {
		bytes[index] = raw.charCodeAt(index);
	}
	return bytes;
}

export function TerminalView({ request }: { request: SshSessionRequest }) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const sessionIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (!containerRef.current) return;

		const terminal = new Terminal({
			convertEol: true,
			cursorBlink: true,
			fontFamily: 'Iosevka Term, monospace',
			fontSize: 13,
			scrollback: 5000,
		});
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.open(containerRef.current);
		fitAddon.fit();

		terminalRef.current = terminal;
		fitRef.current = fitAddon;

		const channel = new Channel<TerminalEvent>();
		channel.onmessage = (event) => {
			switch (event.type) {
				case 'stdout': {
					const bytes = base64ToBytes(event.chunk_b64);
					terminal.write(decoder.decode(bytes));
					break;
				}
				case 'closed': {
					terminal.writeln(`\r\n[closed] ${event.reason}`);
					break;
				}
				case 'error': {
					terminal.writeln(`\r\n[error] ${event.message}`);
					break;
				}
				default:
					break;
			}
		};

		void invoke<string>('open_session', { request, events: channel }).then((sessionId) => {
			sessionIdRef.current = sessionId;
		});

		const disposable = terminal.onData((data) => {
			const sessionId = sessionIdRef.current;
			if (!sessionId) return;
			const payload = bytesToBase64(encoder.encode(data));
			void invoke('send_input', { sessionId, dataB64: payload });
		});

		const resizeObserver = new ResizeObserver(() => {
			fitAddon.fit();
			const sessionId = sessionIdRef.current;
			if (!sessionId) return;
			void invoke('resize_session', {
				sessionId,
				cols: terminal.cols,
				rows: terminal.rows,
			});
		});
		resizeObserver.observe(containerRef.current);

		return () => {
			resizeObserver.disconnect();
			disposable.dispose();
			terminal.dispose();

			const sessionId = sessionIdRef.current;
			if (sessionId) {
				void invoke('close_session', { sessionId });
			}
		};
	}, [request]);

	return <div ref={containerRef} style={{ height: '100%', width: '100%' }} />;
}
```

### Decision clave

- `terminal.write(...)` va directo al objeto `Terminal`.
- React solo maneja lifecycle del componente.
- El store global debe almacenar metadatos de sesion, no el stream de bytes.

## 10. Seguridad: cifrado de credenciales

El vault local y cualquier sincronizacion zero-knowledge deben usar cifrado por envoltura.

### Flujo recomendado

1. El usuario introduce una `master password`.
2. Se genera un `salt` aleatorio de 16 o 32 bytes.
3. Se deriva una `master key` con Argon2id.
4. Se genera una `data encryption key` aleatoria de 32 bytes.
5. Cada secreto se cifra con AES-256-GCM usando la DEK y nonce unico.
6. La DEK se cifra con la master key.
7. Se persisten `salt`, parametros Argon2id, `wrapped_dek`, `ciphertext`, `nonce` y `aad`.

### Parametros Argon2id sugeridos

- Memoria: 64 MB a 256 MB segun target.
- Iteraciones: 3.
- Paralelismo: 1 a 4.
- Output: 32 bytes.

### Esquema de cifrado

```text
master_password
	-> Argon2id(salt, memory_cost, iterations, parallelism)
	-> master_key[32]

random(32) -> data_encryption_key

AES-256-GCM(master_key, dek_nonce, aad=vault_id) -> wrapped_dek
AES-256-GCM(data_encryption_key, secret_nonce, aad=secret_metadata) -> ciphertext
```

### Ejemplo Rust

```rust
use aes_gcm::{
		aead::{Aead, KeyInit, Payload},
		Aes256Gcm, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;

pub fn derive_master_key(password: &[u8], salt: &[u8]) -> anyhow::Result<[u8; 32]> {
		let params = Params::new(64 * 1024, 3, 1, Some(32))?;
		let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
		let mut output = [0u8; 32];
		argon.hash_password_into(password, salt, &mut output)?;
		Ok(output)
}

pub fn encrypt_secret(
		master_key: &[u8; 32],
		dek: &[u8; 32],
		dek_nonce: &[u8; 12],
		secret_nonce: &[u8; 12],
		aad: &[u8],
		plaintext: &[u8],
) -> anyhow::Result<(Vec<u8>, Vec<u8>)> {
		let wrap_cipher = Aes256Gcm::new_from_slice(master_key)?;
		let wrapped_dek = wrap_cipher.encrypt(
				Nonce::from_slice(dek_nonce),
				Payload { msg: dek, aad },
		)?;

		let secret_cipher = Aes256Gcm::new_from_slice(dek)?;
		let ciphertext = secret_cipher.encrypt(
				Nonce::from_slice(secret_nonce),
				Payload { msg: plaintext, aad },
		)?;

		Ok((wrapped_dek, ciphertext))
}

pub fn random_array<const N: usize>() -> [u8; N] {
		let mut bytes = [0u8; N];
		rand::thread_rng().fill_bytes(&mut bytes);
		bytes
}
```

### Reglas de seguridad operativa

- Nunca persistas la master password.
- Nunca reutilices nonce con la misma clave AES-GCM.
- Usa `zeroize` al liberar secretos temporales.
- Guarda metadata de algoritmo y costos Argon2id junto con el ciphertext para permitir migraciones.
- Separa secretos sincronizados de secretos de sesion efimera.

## 11. Shared Vault: JSON con herencia de permisos

### Requisitos funcionales

- Carpetas con ACL heredable.
- Permisos efectivos resueltos desde raiz hasta nodo hoja.
- Soporte para `deny` explicito con prioridad sobre `allow`.
- Versionado y audit trail.
- Secretos referenciados por `secret_ref`, no necesariamente embebidos.

### Modelo JSON sugerido

```json
{
	"vault_id": "vault-team-prod",
	"name": "Team Production",
	"version": 12,
	"root": {
		"id": "root",
		"kind": "folder",
		"name": "/",
		"inherit_permissions": true,
		"permissions": [
			{
				"subject": { "type": "role", "id": "sre" },
				"effect": "allow",
				"actions": ["read", "connect", "share", "manage_secrets"]
			},
			{
				"subject": { "type": "role", "id": "viewer" },
				"effect": "allow",
				"actions": ["read"]
			}
		],
		"children": [
			{
				"id": "folder-erp",
				"kind": "folder",
				"name": "ERP",
				"inherit_permissions": true,
				"permissions": [
					{
						"subject": { "type": "group", "id": "erp-oncall" },
						"effect": "allow",
						"actions": ["connect", "execute", "view_logs"]
					}
				],
				"children": [
					{
						"id": "server-erp-prod-01",
						"kind": "server",
						"name": "erp-prod-01",
						"host": "10.20.0.15",
						"port": 22,
						"auth": {
							"method": "ssh_certificate",
							"secret_ref": "secret://vault-team-prod/erp/erp-prod-01/key"
						},
						"permissions": [
							{
								"subject": { "type": "user", "id": "contractor-01" },
								"effect": "deny",
								"actions": ["connect", "execute"]
							}
						],
						"metadata": {
							"environment": "production",
							"owner_team": "erp"
						}
					}
				]
			}
		]
	},
	"audit": {
		"created_by": "user-123",
		"created_at": "2026-03-06T10:30:00Z",
		"updated_at": "2026-03-06T11:00:00Z"
	}
}
```

### Resolucion de permisos

Algoritmo recomendado:

1. Construir el path desde raiz al nodo objetivo.
2. Acumular ACL de cada folder con `inherit_permissions = true`.
3. Agregar ACL del nodo actual.
4. Resolver por precedencia: `deny` explicito > `allow` explicito > ausencia.
5. Materializar `effective_permissions` en cache para lecturas frecuentes.

## 12. Colaboracion y session mirroring

### Roles de colaboracion

- `owner`: controla y comparte la sesion.
- `editor`: puede escribir en la terminal.
- `viewer`: solo lectura.

### Flujo

1. La sesion primaria emite stdout a su propio `broadcast::Sender`.
2. El modulo `session_mirror` suscribe viewers/editors autorizados.
3. Input de colaboradores entra por una cola separada y se arbitra por rol.
4. Cada input colaborativo queda auditado con `actor_id`, timestamp y session_id.

No mezcles colaboracion con el stream SSH base. Tratalo como una capa encima del `SessionHandle`.

## 13. Riesgos y decisiones de arquitectura

### Riesgos reales

- Tauri IPC no es binario puro end-to-end; el ultimo salto puede requerir serializacion.
- xterm.js sigue consumiendo texto UTF-8/UTF-16 en el browser runtime; el zero-copy total solo aplica al backend y parcialmente al boundary.
- Certificados SSH efimeros exigen control-plane serio: CA, expiracion, revocacion y clock sync.
- CGNAT universalmente resuelto requiere relay persistente; no basta con reverse port forward en todos los entornos.

### Decisiones recomendadas

- Mantener zero-copy fuerte en Rust y aceptar serializacion acotada en Tauri UI boundary.
- Usar `agent-node` para entornos privados/cerrados; no intentar resolver todo desde desktop-only.
- Modelar el vault como documento versionado con snapshots y eventos, no como arbol mutable sin historial.

## 14. MVP ejecutable

Orden recomendado de implementacion:

1. Sesion SSH unica con `russh` + xterm.js.
2. Multiples sesiones concurrentes con `tokio` y `SessionManager`.
3. Vault local cifrado con Argon2id + AES-256-GCM.
4. Certificados SSH efimeros via control-plane.
5. Relay saliente para CGNAT.
6. Shared Vault y session mirroring.

## 15. Entregable minimo del core

Si tuviera que convertir este documento en codigo inmediatamente, el primer milestone incluiria:

- `Cargo.toml` anterior como base.
- `main.rs` con comandos `open_session`, `send_input`, `resize_session`, `close_session`.
- `connect_ssh` con `russh`, PTY y shell remota.
- `TerminalView.tsx` usando `Channel` de Tauri y `xterm.js`.
- `crypto/envelope.rs` con derivacion Argon2id y AES-256-GCM.
- `shared_vault.rs` con parser, validacion y resolucion de permisos efectivos.

Con eso tienes el nucleo correcto: transporte, concurrencia, seguridad de secretos y base de colaboracion. Lo que sigue es endurecimiento operativo, auditoria y UX.

## 16. Estado actual del proyecto

El repositorio ya no esta en fase puramente conceptual. A fecha de este documento existe un scaffold real con estos bloques creados:

- `app-client/` con frontend React + Vite y backend Tauri v2.
- `app-client/src-tauri/src/core/ssh_client.rs` con un cliente SSH base sobre `russh`.
- `app-client/src-tauri/src/commands/session.rs` con comandos `open_session`, `send_input`, `resize_session` y `close_session`.
- `app-client/src-ui/src/components/TerminalView.tsx` con `xterm.js` conectado al backend por `Channel` de Tauri.
- `control-plane/` con endpoints iniciales de health, emision de certificados y leases de relay.
- `agent-node/` con un bootstrap minimo para el conector reverso hacia relay.

### Estado de validacion conocido

- El frontend `app-client` ya compila correctamente con `npm run build`.
- La validacion Rust esta bloqueada por entorno Windows incompleto cuando se usa target `x86_64-pc-windows-msvc` sin `link.exe` de MSVC.
- El bloqueo `Blocking waiting for file lock` observado en `cargo` fue secundario; el error estructural es la ausencia del linker de Visual C++.

### Prerrequisitos de entorno para continuar

Antes de seguir con el desarrollo productivo, el entorno Windows debe quedar completo con:

- Visual Studio Build Tools 2022.
- Workload `Desktop development with C++`.
- MSVC x64/x86 build tools.
- Windows SDK.

Condicion de salida de esta etapa:

- `where link` debe devolver una ruta valida.
- `cargo check` debe poder ejecutarse en `control-plane`, `agent-node` y `app-client/src-tauri`.

## 17. Roadmap del prototipo

El desarrollo debe tratarse como una secuencia de capas cerradas, no como una expansion horizontal de features. El orden correcto es: entorno, conectividad base, seguridad local, control-plane y colaboracion.

### Fase 0. Entorno y compilacion estable

Objetivo:

- Eliminar bloqueos del toolchain y dejar el workspace compilable en Windows.

Trabajo:

- Instalar Build Tools con C++.
- Verificar `rustup show`, `rustc -vV` y `where link`.
- Ejecutar `cargo check` por crate.
- Corregir incompatibilidades reales de API de `russh`, `tauri` y crates auxiliares.

Condiciones de salida:

- `cargo check` limpio en `control-plane`.
- `cargo check` limpio en `agent-node`.
- `cargo check` limpio en `app-client/src-tauri`.
- `npm run build` limpio en `app-client`.

Prioridad: critica.

### Fase 1. Conexion SSH minima usable

Objetivo:

- Abrir una sesion SSH real contra un host conocido y ver I/O interactivo en `xterm.js`.

Trabajo ya iniciado:

- Cliente SSH base.
- Comandos Tauri de sesion.
- `TerminalView` con canal bidireccional.

Trabajo faltante:

- Confirmar compatibilidad exacta con la version de `russh` fijada.
- Soportar passphrase de clave privada local.
- Robustecer resize, cierre remoto, EOF y manejo de errores.
- Añadir un flujo de formulario que no dependa de valores demo hardcoded.

Condiciones de salida:

- Conexion exitosa con Ed25519 hacia un servidor real.
- Ejecucion interactiva de shell remota.
- Resize de terminal funcional.
- Cierre limpio desde UI y desde peer remoto.

Prioridad: critica.

### Fase 2. Vault local cifrado funcional

Objetivo:

- Persistir perfiles y secretos localmente con cifrado fuerte y recuperarlos desde la UI.

Trabajo ya iniciado:

- Base de Argon2id + AES-256-GCM en `crypto/envelope.rs`.

Trabajo faltante:

- Definir ruta fija del vault por usuario.
- Implementar `save_local_vault` y `load_local_vault` como comandos Tauri.
- Persistir metadata de KDF, nonce, salt y version de formato.
- Soportar multiples entradas, rotacion de master password y actualizacion atomica.
- Borrado seguro en memoria de buffers temporales.

Condiciones de salida:

- Guardar perfiles SSH cifrados localmente.
- Recuperar perfiles con master password correcta.
- Fallar de forma segura con password incorrecta.
- No almacenar secretos en texto plano en disco.

Prioridad: critica.

### Fase 3. Verificacion de host key y endurecimiento SSH

Objetivo:

- Evitar conexiones ciegas y dejar el cliente listo para una primera conexion real mas segura.

Trabajo faltante:

- Validar fingerprint SHA-256 y formato OpenSSH de host key.
- Rechazar por defecto conexiones sin host key esperada o sin onboarding explicito.
- Implementar politica de `known_hosts` propia del vault.
- Registrar fingerprint al primer trust solo bajo confirmacion consciente del usuario.
- Mejorar logs de auth, fallos de handshake y timeouts.

Condiciones de salida:

- El cliente rechaza peers no confiables.
- El usuario puede hacer onboarding de una host key de forma controlada.
- Los errores de host key quedan explicados en UI.

Prioridad: critica.

### Fase 4. Certificados efimeros y CA real

Objetivo:

- Mover la identidad SSH hacia certificados efimeros firmados por el control-plane.

Trabajo ya iniciado:

- Endpoint inicial de emision de certificado en `control-plane`.

Trabajo faltante:

- Modelar una CA Ed25519 real.
- Definir principals, TTL, key ID y constraints por entorno.
- Firmar certificados OpenSSH validos, no solo payloads placeholder.
- Validar identidad del usuario antes de emitir.
- Gestionar expiracion, revocacion y auditoria minima.

Condiciones de salida:

- Emision real de certificado efimero desde control-plane.
- Uso de `authenticate_openssh_cert` desde el cliente.
- Renovacion automatica antes de expirar.

Prioridad: alta.

### Fase 5. Relay CGNAT y agent-node funcionales

Objetivo:

- Alcanzar nodos detras de CGNAT usando conectividad saliente desde el `agent-node`.

Trabajo ya iniciado:

- Scaffold de `agent-node`.
- Endpoints iniciales de leases en `control-plane`.

Trabajo faltante:

- Protocolo de registro del nodo.
- Lease firmado o token de corta duracion.
- Multiplexacion de trafico cliente <-> relay <-> agent.
- Heartbeats, expiracion de sesion y reconexion.
- Mapeo entre `target_node_id` y sockets vivos.

Condiciones de salida:

- Un cliente puede abrir una sesion a un nodo sin puertos entrantes abiertos.
- El relay invalida leases expirados.
- El nodo se re-registra tras caidas.

Prioridad: alta.

### Fase 6. Shared Vault y colaboracion minima

Objetivo:

- Compartir perfiles y permisos entre usuarios, y habilitar visualizacion remota de sesiones.

Trabajo ya iniciado:

- Modelo de `SharedVault` y `session_mirror` base.

Trabajo faltante:

- Persistencia del documento del vault compartido.
- Resolucion de permisos efectivos por path.
- Versionado y control de cambios.
- Sesion espejo en solo lectura.
- Auditoria de participantes y comandos colaborativos.

Condiciones de salida:

- Un vault compartido puede listar servidores con ACL efectiva.
- Un segundo usuario puede observar una sesion autorizada.

Prioridad: media.

### Fase 7. Prototipo funcional de punta a punta

Objetivo:

- Demostrar el producto completo en un flujo realista.

Flujo esperado:

1. El usuario abre la app.
2. Desbloquea su vault local.
3. Carga un perfil o solicita un certificado efimero.
4. Si el host esta detras de CGNAT, usa relay + agent-node.
5. Abre la terminal interactiva.
6. El control-plane registra evento y politica aplicada.

Condiciones de salida:

- Demo completa reproducible.
- Build local consistente.
- Baseline de seguridad razonable.

Prioridad: critica.

### Estado validado al 2026-03-07

- Fase 0 cerrada: workspace, `app-client`, `control-plane` y `agent-node` compilan con `cargo check`; `npm run build` del cliente queda limpio.
- Fase 1 cerrada: la app abre sesion SSH real con `russh`, valida host key y ya tiene prueba de conexion contra servidor SSH local.
- Fase 2 cerrada: el vault local usa cifrado simetrico con metadata KDF persistida, guardado atomico y rotacion de master password.
- Fase 3 cerrada: el cliente exige fingerprint/host key explicita y corta la conexion si no coincide.
- Fase 4 cerrada: el control-plane persiste una CA Ed25519 real, emite certificados OpenSSH validos y el cliente los reutiliza o renueva automaticamente.
- Fase 5 cerrada en su baseline funcional: hay registro de nodo, lease efimero, claim por `target_node_id`, relay TCP real, expiracion, re-registro del `agent-node` y proxy binario cliente <-> relay <-> SSH local.
- Fase 6 cerrada en su baseline funcional: el shared vault persiste en disco con versionado minimo, ya admite alta/baja de servidores desde la UI, resuelve ACL efectiva por servidor, registra auditoria colaborativa local y el cliente expone session mirror read-only para observadores autorizados.
- Fase 7 queda parcial: ya existe un flujo demo reproducible en la app, pero falta endurecer observabilidad, auditoria colaborativa y empaquetado del recorrido completo.

## 18. Backlog tecnico inmediato

Este es el backlog mas pragmatica para las siguientes iteraciones de codigo.

### App client

- Sustituir el formulario demo por un formulario real conectado a estado estable.
- Implementar persistencia del vault local.
- Soportar importacion de clave privada y certificado.
- Añadir onboarding de fingerprint de host.
- Mostrar errores de conexion, auth y relay en UI.
- Evitar recrear la sesion si cambia estado no estructural del formulario.

### Backend Tauri

- Alinear `Cargo.toml` real con las APIs efectivas de `russh`.
- Revisar compatibilidad de `decode_secret_key`, certificados OpenSSH y fingerprints.
- Añadir timeouts de conexion y cancelacion.
- Separar errores de handshake, auth, host key y shell.
- Persistir `known_hosts` en el vault local.

### Control-plane

- Sustituir certificados placeholder por firma real.
- Añadir auth de usuario o token de sesion.
- Modelar registros de nodo y leases activos.
- Definir almacenamiento para CA, leases y auditoria.

### Agent-node

- Implementar handshake con relay.
- Exponer metadata del nodo.
- Añadir heartbeats y reconexion automatica.
- Encapsular trafico SSH real en el canal saliente.

## 19. Backlog de producto a mediano plazo

- SFTP lazy-load con lectura incremental y save-on-write.
- Dashboard de microservicios con `actuator/health` o checks custom.
- WebAuthn o factor fuerte para desbloqueo del vault o emision de certificados.
- Session mirroring con permisos `viewer` y `editor`.
- Historial de conexiones, favoritos y tags por entorno.
- Politicas por equipo, entorno y criticidad del host.
- Rotacion automatica de certificados y tokens de relay.

## 20. Backlog de largo plazo

- Relay distribuido con multiples regiones.
- Revocacion online de certificados y cache local de CRL o politica equivalente.
- Plugin binario o sidecar para reducir el overhead del boundary IPC.
- Grabacion y auditoria estructurada de sesiones.
- Aprobaciones en tiempo real para accesos sensibles.
- Integracion con proveedores de identidad corporativos.
- Politicas de acceso just-in-time.
- Soporte multi-plataforma endurecido para Linux y macOS.

## 21. Riesgos de entrega

Los principales riesgos que pueden frenar el prototipo no son cosmeticos, son estructurales:

- Entorno Windows incompleto para Rust/Tauri.
- Friccion de API real entre versiones de `russh` y el codigo planeado.
- Complejidad de certificados OpenSSH y firma real en control-plane.
- Sobrecarga accidental en el boundary Tauri si el stream termina serializandose demasiado.
- Coste de construir un relay CGNAT correcto sin caer en un pseudo-tunel fragil.
- Seguridad del vault si el formato queda ambiguo o sin versionado.

Mitigacion:

- Validar por fases con criterios de salida concretos.
- No mezclar colaboracion, SFTP y relay antes de cerrar SSH interactivo + vault.
- Tratar CA y relay como servicios first-class, no como utilidades accesorias.

## 22. Criterios para considerar el prototipo completamente funcional

El prototipo no debe considerarse funcional solo porque abra una terminal. Debe cumplir al menos con este minimo de punta a punta:

### Infraestructura

- Workspace compila completo.
- `app-client` build limpio.
- `control-plane` build limpio.
- `agent-node` build limpio.

### Seguridad

- Vault local cifrado real.
- Verificacion de host key.
- Certificado efimero emitido por control-plane.
- No hay secretos persistidos en claro.

### Conectividad

- SSH directo operativo.
- SSH via relay operativo.
- Manejo correcto de cierre, timeout y reconexion.

### UX minima

- Formulario de conexion real.
- Selector de perfiles.
- Mensajes de error accionables.
- Estado visible de sesion, relay y autenticacion.

### Colaboracion minima

- Shared Vault legible.
- Permisos efectivos resueltos.
- Al menos un modo `viewer` operativo para mirroring.

Cuando esos cinco bloques esten cerrados, el sistema ya deja de ser un scaffold tecnico y pasa a ser un prototipo funcional serio.
