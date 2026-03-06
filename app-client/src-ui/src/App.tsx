import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TerminalView } from './components/TerminalView';
import { useTerminalSession } from './hooks/useTerminalSession';
import type { LocalVaultResponse, RelayHint, SshSessionRequest, VaultEntry } from './types/api';

type FormState = {
  name: string;
  host: string;
  port: string;
  username: string;
  knownHostFingerprint: string;
  privateKeyPem: string;
  privateKeyPassphrase: string;
  certificatePem: string;
  relayUrl: string;
  relayToken: string;
  relayTargetNodeId: string;
};

const initialForm: FormState = {
  name: 'Servidor principal',
  host: '127.0.0.1',
  port: '22',
  username: 'ozy',
  knownHostFingerprint: '',
  privateKeyPem: '',
  privateKeyPassphrase: '',
  certificatePem: '',
  relayUrl: '',
  relayToken: '',
  relayTargetNodeId: '',
};

export default function App() {
  const session = useTerminalSession();
  const [form, setForm] = useState<FormState>(initialForm);
  const [activeRequest, setActiveRequest] = useState<SshSessionRequest | null>(null);
  const [vaultPassword, setVaultPassword] = useState('');
  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>([]);
  const [vaultPath, setVaultPath] = useState('');
  const [vaultUpdatedAt, setVaultUpdatedAt] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('vault local listo');

  const activeRelay = useMemo<RelayHint | undefined>(() => {
    if (!form.relayUrl || !form.relayToken || !form.relayTargetNodeId) {
      return undefined;
    }

    return {
      relayUrl: form.relayUrl,
      token: form.relayToken,
      targetNodeId: form.relayTargetNodeId,
    };
  }, [form.relayTargetNodeId, form.relayToken, form.relayUrl]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toVaultEntry(): VaultEntry {
    return {
      id: crypto.randomUUID(),
      name: form.name || `${form.username}@${form.host}`,
      host: form.host,
      port: Number(form.port || 22),
      username: form.username,
      privateKeyPem: form.privateKeyPem,
      privateKeyPassphrase: form.privateKeyPassphrase || undefined,
      certificatePem: form.certificatePem || undefined,
      knownHostFingerprint: form.knownHostFingerprint || undefined,
      relayHint: activeRelay,
    };
  }

  function toSessionRequest(): SshSessionRequest {
    return {
      host: form.host,
      port: Number(form.port || 22),
      username: form.username,
      privateKeyPem: form.privateKeyPem,
      privateKeyPassphrase: form.privateKeyPassphrase || undefined,
      certificatePem: form.certificatePem || undefined,
      knownHostFingerprint: form.knownHostFingerprint || undefined,
      cols: 120,
      rows: 34,
      relayHint: activeRelay,
    };
  }

  function loadEntry(entry: VaultEntry) {
    setForm({
      name: entry.name,
      host: entry.host,
      port: String(entry.port),
      username: entry.username,
      knownHostFingerprint: entry.knownHostFingerprint ?? '',
      privateKeyPem: entry.privateKeyPem,
      privateKeyPassphrase: entry.privateKeyPassphrase ?? '',
      certificatePem: entry.certificatePem ?? '',
      relayUrl: entry.relayHint?.relayUrl ?? '',
      relayToken: entry.relayHint?.token ?? '',
      relayTargetNodeId: entry.relayHint?.targetNodeId ?? '',
    });
    setFeedback(`perfil cargado: ${entry.name}`);
  }

  async function saveVault() {
    if (!vaultPassword) {
      setFeedback('define una master password para guardar el vault');
      return;
    }

    const nextEntries = upsertEntry(vaultEntries, toVaultEntry());
    const response = await invoke<LocalVaultResponse>('save_local_vault', {
      request: {
        masterPassword: vaultPassword,
        entries: nextEntries,
      },
    });

    setVaultEntries(response.entries);
    setVaultPath(response.vaultPath);
    setVaultUpdatedAt(response.updatedAt);
    setFeedback(`vault guardado en ${response.vaultPath}`);
  }

  async function loadVault() {
    if (!vaultPassword) {
      setFeedback('define la master password para abrir el vault');
      return;
    }

    const response = await invoke<LocalVaultResponse>('load_local_vault', {
      request: { masterPassword: vaultPassword },
    });

    setVaultEntries(response.entries);
    setVaultPath(response.vaultPath);
    setVaultUpdatedAt(response.updatedAt);
    if (response.entries[0]) {
      loadEntry(response.entries[0]);
    } else {
      setFeedback('vault cargado, sin perfiles guardados');
    }
  }

  function connect() {
    setActiveRequest(toSessionRequest());
    setFeedback(`abriendo sesion contra ${form.host}:${form.port}`);
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">OzyTerminal</p>
          <h1>Collaborative SSH terminal core</h1>
          <p className="lede">
            Cliente Tauri con formulario real de conexion, vault local cifrado y verificacion explicita de host key.
          </p>
        </div>
        <div className="badge">{session.status}</div>
      </section>

      <section className="workspace">
        <aside className="sidebar">
          <h2>Conexion</h2>
          <div className="status-card">
            <span className={`status-pill is-${session.status}`}>{session.status}</span>
            <p>{session.message}</p>
            {session.sessionId ? <p className="mono">{session.sessionId}</p> : null}
          </div>

          <div className="form-grid">
            <label>
              <span>Perfil</span>
              <input value={form.name} onChange={(event) => updateField('name', event.target.value)} />
            </label>
            <label>
              <span>Host</span>
              <input value={form.host} onChange={(event) => updateField('host', event.target.value)} />
            </label>
            <label>
              <span>Puerto</span>
              <input value={form.port} onChange={(event) => updateField('port', event.target.value)} />
            </label>
            <label>
              <span>Usuario</span>
              <input value={form.username} onChange={(event) => updateField('username', event.target.value)} />
            </label>
            <label>
              <span>Fingerprint SHA-256 o clave OpenSSH</span>
              <input
                value={form.knownHostFingerprint}
                onChange={(event) => updateField('knownHostFingerprint', event.target.value)}
                placeholder="SHA256:..."
              />
            </label>
            <label>
              <span>Passphrase de la clave</span>
              <input
                type="password"
                value={form.privateKeyPassphrase}
                onChange={(event) => updateField('privateKeyPassphrase', event.target.value)}
              />
            </label>
            <label className="full-width">
              <span>Private Key PEM</span>
              <textarea
                rows={8}
                value={form.privateKeyPem}
                onChange={(event) => updateField('privateKeyPem', event.target.value)}
              />
            </label>
            <label className="full-width">
              <span>Certificado OpenSSH opcional</span>
              <textarea
                rows={3}
                value={form.certificatePem}
                onChange={(event) => updateField('certificatePem', event.target.value)}
              />
            </label>
          </div>

          <h3>Relay CGNAT</h3>
          <div className="form-grid">
            <label>
              <span>Relay URL</span>
              <input value={form.relayUrl} onChange={(event) => updateField('relayUrl', event.target.value)} />
            </label>
            <label>
              <span>Token</span>
              <input value={form.relayToken} onChange={(event) => updateField('relayToken', event.target.value)} />
            </label>
            <label>
              <span>Target Node</span>
              <input
                value={form.relayTargetNodeId}
                onChange={(event) => updateField('relayTargetNodeId', event.target.value)}
              />
            </label>
          </div>

          <h3>Vault Local</h3>
          <div className="form-grid">
            <label className="full-width">
              <span>Master Password</span>
              <input
                type="password"
                value={vaultPassword}
                onChange={(event) => setVaultPassword(event.target.value)}
              />
            </label>
          </div>
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => void loadVault()}>
              Cargar Vault
            </button>
            <button type="button" className="secondary" onClick={() => void saveVault()}>
              Guardar Perfil
            </button>
            <button type="button" className="primary" onClick={connect}>
              Conectar
            </button>
          </div>
          <p className="hint">{feedback}</p>
          {vaultPath ? <p className="hint mono">{vaultPath}</p> : null}
          {vaultUpdatedAt ? <p className="hint">Actualizado: {new Date(vaultUpdatedAt * 1000).toLocaleString()}</p> : null}

          <div className="vault-list">
            {vaultEntries.map((entry) => (
              <button key={entry.id} type="button" className="vault-item" onClick={() => loadEntry(entry)}>
                <strong>{entry.name}</strong>
                <span>{entry.username}@{entry.host}:{entry.port}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="terminal-card">
          {activeRequest ? <TerminalView request={activeRequest} /> : <IdleTerminalCard />} 
        </div>
      </section>
    </main>
  );
}

function IdleTerminalCard() {
  return (
    <div className="terminal-placeholder">
      <h2>Sesion inactiva</h2>
      <p>Carga un perfil del vault o completa el formulario y pulsa Conectar.</p>
      <p className="hint">La conexion exige una fingerprint SHA-256 o una clave OpenSSH del servidor.</p>
    </div>
  );
}

function upsertEntry(entries: VaultEntry[], next: VaultEntry) {
  const matchIndex = entries.findIndex((entry) => entry.name === next.name || entry.id === next.id);
  if (matchIndex === -1) {
    return [...entries, next];
  }

  return entries.map((entry, index) => (index === matchIndex ? { ...next, id: entry.id } : entry));
}
