import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TerminalView } from './components/TerminalView';
import { useTerminalSession } from './hooks/useTerminalSession';
import type {
  CollabAuditEntriesResponse,
  ControlPlaneConfig,
  LocalVaultResponse,
  RelayHint,
  ResolvedRelayLease,
  ResolvedSshCertificate,
  SessionMirrorSnapshot,
  SessionMirrorSummary,
  SharedVaultEntriesResponse,
  SharedVaultResponse,
  SharedVaultServerView,
  SshSessionRequest,
  VaultEntry,
} from './types/api';

type FormState = {
  name: string;
  host: string;
  port: string;
  username: string;
  knownHostFingerprint: string;
  privateKeyPem: string;
  privateKeyPassphrase: string;
  certificatePem: string;
  controlPlaneUrl: string;
  controlPlaneToken: string;
  controlPlaneEnvironment: string;
  controlPlanePrincipals: string;
  controlPlaneTtlSeconds: string;
  controlPlaneRenewBeforeSeconds: string;
  relayUrl: string;
  relayToken: string;
  relayTargetNodeId: string;
  mirrorOwnerId: string;
  mirrorViewerId: string;
  sharedVaultActorId: string;
  sharedVaultParentId: string;
  sharedVaultNodeId: string;
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
  controlPlaneUrl: '',
  controlPlaneToken: '',
  controlPlaneEnvironment: 'development',
  controlPlanePrincipals: '',
  controlPlaneTtlSeconds: '900',
  controlPlaneRenewBeforeSeconds: '60',
  relayUrl: '',
  relayToken: '',
  relayTargetNodeId: '',
  mirrorOwnerId: 'local-operator',
  mirrorViewerId: 'auditor-1',
  sharedVaultActorId: 'local-operator',
  sharedVaultParentId: 'root',
  sharedVaultNodeId: '',
};

export default function App() {
  const session = useTerminalSession();
  const [form, setForm] = useState<FormState>(initialForm);
  const [activeRequest, setActiveRequest] = useState<SshSessionRequest | null>(null);
  const [vaultPassword, setVaultPassword] = useState('');
  const [nextVaultPassword, setNextVaultPassword] = useState('');
  const [vaultEntries, setVaultEntries] = useState<VaultEntry[]>([]);
  const [vaultPath, setVaultPath] = useState('');
  const [vaultUpdatedAt, setVaultUpdatedAt] = useState<number | null>(null);
  const [issuedCertificate, setIssuedCertificate] = useState<ResolvedSshCertificate | null>(null);
  const [issuedRelayLease, setIssuedRelayLease] = useState<ResolvedRelayLease | null>(null);
  const [sharedVault, setSharedVault] = useState<SharedVaultResponse | null>(null);
  const [sharedVaultEntries, setSharedVaultEntries] = useState<SharedVaultServerView[]>([]);
  const [sessionMirrors, setSessionMirrors] = useState<SessionMirrorSummary[]>([]);
  const [activeMirror, setActiveMirror] = useState<SessionMirrorSnapshot | null>(null);
  const [collabAuditPath, setCollabAuditPath] = useState('');
  const [collabAuditEntries, setCollabAuditEntries] = useState<CollabAuditEntriesResponse['entries']>([]);
  const [feedback, setFeedback] = useState('vault local listo');

  const activeRelay = useMemo<RelayHint | undefined>(() => {
    if (!form.relayTargetNodeId.trim()) {
      return undefined;
    }

    return {
      relayUrl: form.relayUrl.trim(),
      token: form.relayToken.trim(),
      targetNodeId: form.relayTargetNodeId.trim(),
    };
  }, [form.relayTargetNodeId, form.relayToken, form.relayUrl]);

  const activeControlPlane = useMemo<ControlPlaneConfig | undefined>(() => {
    if (!form.controlPlaneUrl.trim()) {
      return undefined;
    }

    return {
      baseUrl: form.controlPlaneUrl.trim(),
      accessToken: form.controlPlaneToken.trim() || undefined,
      environment: form.controlPlaneEnvironment.trim() || undefined,
      principals: splitList(form.controlPlanePrincipals),
      ttlSeconds: toPositiveNumber(form.controlPlaneTtlSeconds),
      renewBeforeSeconds: toPositiveNumber(form.controlPlaneRenewBeforeSeconds),
    };
  }, [
    form.controlPlaneEnvironment,
    form.controlPlanePrincipals,
    form.controlPlaneRenewBeforeSeconds,
    form.controlPlaneToken,
    form.controlPlaneTtlSeconds,
    form.controlPlaneUrl,
  ]);

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
      controlPlane: activeControlPlane,
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
      controlPlane: activeControlPlane,
      mirrorOwnerId: form.mirrorOwnerId.trim() || undefined,
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
      controlPlaneUrl: entry.controlPlane?.baseUrl ?? '',
      controlPlaneToken: entry.controlPlane?.accessToken ?? '',
      controlPlaneEnvironment: entry.controlPlane?.environment ?? 'development',
      controlPlanePrincipals: entry.controlPlane?.principals.join(', ') ?? '',
      controlPlaneTtlSeconds: entry.controlPlane?.ttlSeconds ? String(entry.controlPlane.ttlSeconds) : '900',
      controlPlaneRenewBeforeSeconds: entry.controlPlane?.renewBeforeSeconds
        ? String(entry.controlPlane.renewBeforeSeconds)
        : '60',
      relayUrl: entry.relayHint?.relayUrl ?? '',
      relayToken: entry.relayHint?.token ?? '',
      relayTargetNodeId: entry.relayHint?.targetNodeId ?? '',
      mirrorOwnerId: form.mirrorOwnerId,
      mirrorViewerId: form.mirrorViewerId,
      sharedVaultActorId: form.sharedVaultActorId,
      sharedVaultParentId: form.sharedVaultParentId,
      sharedVaultNodeId: form.sharedVaultNodeId,
    });
    setIssuedCertificate(null);
    setIssuedRelayLease(null);
    setFeedback(`perfil cargado: ${entry.name}`);
  }

  async function issueCertificate() {
    if (!activeControlPlane) {
      setFeedback('define la URL del control-plane para emitir un certificado');
      return;
    }

    if (!form.host || !form.username || !form.privateKeyPem.trim()) {
      setFeedback('host, usuario y private key son obligatorios para emitir certificado');
      return;
    }

    try {
      const response = await invoke<ResolvedSshCertificate>('issue_ssh_certificate_command', {
        request: {
          host: form.host,
          username: form.username,
          privateKeyPem: form.privateKeyPem,
          privateKeyPassphrase: form.privateKeyPassphrase || undefined,
          existingCertificatePem: form.certificatePem || undefined,
          controlPlane: activeControlPlane,
          reuseIfFresh: true,
        },
      });

      updateField('certificatePem', response.certificatePem);
      setIssuedCertificate(response);
      setFeedback(
        `certificado ${response.source === 'existing' ? 'reutilizado' : 'emitido'}: ${response.keyId}`,
      );
    } catch (error) {
      setFeedback(String(error));
    }
  }

  async function saveVault() {
    if (!vaultPassword) {
      setFeedback('define una master password para guardar el vault');
      return;
    }

    try {
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
    } catch (error) {
      setFeedback(String(error));
    }
  }

  async function loadVault() {
    if (!vaultPassword) {
      setFeedback('define la master password para abrir el vault');
      return;
    }

    try {
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
    } catch (error) {
      setFeedback(String(error));
    }
  }

  async function rotateVaultPassword() {
    if (!vaultPassword || !nextVaultPassword) {
      setFeedback('define la password actual y la nueva para rotar el vault');
      return;
    }

    try {
      const response = await invoke<LocalVaultResponse>('rotate_local_vault_password', {
        request: {
          currentPassword: vaultPassword,
          newPassword: nextVaultPassword,
        },
      });

      setVaultEntries(response.entries);
      setVaultPath(response.vaultPath);
      setVaultUpdatedAt(response.updatedAt);
      setVaultPassword(nextVaultPassword);
      setNextVaultPassword('');
      setFeedback('master password rotada correctamente');
    } catch (error) {
      setFeedback(String(error));
    }
  }

  function connect() {
    if (!form.host || !form.username || !form.privateKeyPem.trim()) {
      setFeedback('host, usuario y private key son obligatorios');
      return;
    }

    if (!form.knownHostFingerprint.trim()) {
      setFeedback('define la fingerprint SHA-256 o la host key OpenSSH antes de conectar');
      return;
    }

    if (
      form.relayTargetNodeId.trim() &&
      !activeControlPlane &&
      (!form.relayUrl.trim() || !form.relayToken.trim())
    ) {
      setFeedback('para usar relay define control-plane o completa relay URL y token');
      return;
    }

    setActiveRequest(toSessionRequest());
    setFeedback(`abriendo sesion contra ${form.host}:${form.port}`);
  }

  async function issueRelayLease() {
    if (!activeControlPlane) {
      setFeedback('define la URL del control-plane para emitir un lease relay');
      return;
    }

    if (!form.relayTargetNodeId.trim()) {
      setFeedback('define el target node para emitir un lease relay');
      return;
    }

    try {
      const response = await invoke<ResolvedRelayLease>('issue_relay_lease_command', {
        request: {
          targetNodeId: form.relayTargetNodeId.trim(),
          requestedPort: Number(form.port || 22),
          purpose: 'ssh',
          controlPlane: activeControlPlane,
        },
      });

      updateField('relayUrl', response.relayAddress);
      updateField('relayToken', response.token);
      setIssuedRelayLease(response);
      setFeedback(`lease relay emitido: ${response.leaseId}`);
    } catch (error) {
      setFeedback(String(error));
    }
  }

  async function loadSharedVault() {
    try {
      const response = await invoke<SharedVaultResponse>('load_shared_vault_command');
      setSharedVault(response);
      await listSharedVaultEntries(form.sharedVaultActorId, response);
      setFeedback(`shared vault cargado: ${response.vault.name}`);
    } catch (error) {
      setFeedback(String(error));
    }
  }

  async function bootstrapSharedVault() {
    const actorId = form.sharedVaultActorId.trim() || form.mirrorOwnerId.trim() || 'local-operator';
    try {
      const response = await invoke<SharedVaultResponse>('bootstrap_demo_shared_vault_command', {
        actorId,
      });
      setSharedVault(response);
      await listSharedVaultEntries(actorId, response);
      setFeedback(`shared vault demo generado: ${response.vault.name}`);
    } catch (error) {
      setFeedback(String(error));
    }
  }

  async function listSharedVaultEntries(actorId = form.sharedVaultActorId, knownVault?: SharedVaultResponse) {
    const normalizedActorId = actorId.trim();
    if (!normalizedActorId) {
      setFeedback('define un actor para resolver ACL del shared vault');
      return;
    }

    try {
      const response = await invoke<SharedVaultEntriesResponse>('list_shared_vault_entries_command', {
        request: {
          actorIds: [normalizedActorId],
        },
      });
      setSharedVaultEntries(response.entries);
      if (knownVault) {
        setSharedVault(knownVault);
      }
      setFeedback(`ACL resuelta para ${normalizedActorId}: ${response.entries.length} servidor(es)`);
    } catch (error) {
      setFeedback(String(error));
    }
  }

  function applySharedVaultEntry(entry: SharedVaultServerView) {
    updateField('name', entry.name);
    updateField('host', entry.host);
    updateField('port', String(entry.port));
    updateField('username', entry.username);
    updateField('knownHostFingerprint', entry.knownHostFingerprint ?? '');
    updateField('relayTargetNodeId', entry.relayTargetNodeId ?? '');
    updateField('sharedVaultNodeId', entry.nodeId);
    setFeedback(`perfil aplicado desde shared vault: ${entry.name}`);
  }

  async function upsertSharedVaultServer() {
    const actorId = form.sharedVaultActorId.trim();
    if (!actorId) {
      setFeedback('define el actor que edita el shared vault');
      return;
    }
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      setFeedback('nombre, host y usuario son obligatorios para guardar en shared vault');
      return;
    }

    try {
      const response = await invoke<SharedVaultResponse>('upsert_shared_vault_server_command', {
        request: {
          actorId,
          expectedVersion: sharedVault?.vault.version,
          parentId: form.sharedVaultParentId.trim() || 'root',
          nodeId: form.sharedVaultNodeId.trim() || undefined,
          name: form.name.trim(),
          host: form.host.trim(),
          port: Number(form.port || 22),
          username: form.username.trim(),
          knownHostFingerprint: form.knownHostFingerprint.trim() || undefined,
          relayTargetNodeId: form.relayTargetNodeId.trim() || undefined,
          environment: form.controlPlaneEnvironment.trim() || undefined,
        },
      });

      setSharedVault(response);
      await listSharedVaultEntries(actorId, response);
      setFeedback(`shared vault actualizado: ${form.name.trim()}`);
    } catch (error) {
      setFeedback(String(error));
    }
  }

  async function deleteSharedVaultNode() {
    const actorId = form.sharedVaultActorId.trim();
    const nodeId = form.sharedVaultNodeId.trim();
    if (!actorId || !nodeId) {
      setFeedback('define actor y selecciona un nodeId del shared vault para eliminar');
      return;
    }

    try {
      const response = await invoke<SharedVaultResponse>('delete_shared_vault_node_command', {
        request: {
          actorId,
          expectedVersion: sharedVault?.vault.version,
          nodeId,
        },
      });

      setSharedVault(response);
      setSharedVaultEntries((current) => current.filter((entry) => entry.nodeId !== nodeId));
      updateField('sharedVaultNodeId', '');
      setFeedback(`shared vault eliminó el nodo ${nodeId}`);
    } catch (error) {
      setFeedback(String(error));
    }
  }

  async function loadCollabAudit() {
    try {
      const response = await invoke<CollabAuditEntriesResponse>('list_collab_audit_entries_command', {
        request: { limit: 20 },
      });
      setCollabAuditEntries(response.entries);
      setCollabAuditPath(response.auditPath);
      setFeedback(`audit colaborativo cargado: ${response.entries.length} evento(s)`);
    } catch (error) {
      setFeedback(String(error));
    }
  }

  async function shareActiveSessionMirror() {
    if (!session.sessionId) {
      setFeedback('no hay una sesion activa para compartir');
      return;
    }

    if (!form.mirrorOwnerId.trim() || !form.mirrorViewerId.trim()) {
      setFeedback('define owner y viewer para compartir el mirror');
      return;
    }

    try {
      const response = await invoke<SessionMirrorSnapshot>('share_session_mirror_command', {
        request: {
          sessionId: session.sessionId,
          grantedByActorId: form.mirrorOwnerId.trim(),
          targetActorId: form.mirrorViewerId.trim(),
          role: 'viewer',
        },
      });
      setActiveMirror(response);
      setFeedback(`mirror compartido con ${form.mirrorViewerId.trim()}`);
    } catch (error) {
      setFeedback(String(error));
    }
  }

  async function loadSessionMirrors(actorId = form.mirrorViewerId) {
    const normalizedActorId = actorId.trim();
    if (!normalizedActorId) {
      setFeedback('define un actor para listar mirrors');
      return;
    }

    try {
      const response = await invoke<SessionMirrorSummary[]>('list_session_mirrors_command', {
        request: { actorId: normalizedActorId },
      });
      setSessionMirrors(response);
      setFeedback(`mirrors visibles para ${normalizedActorId}: ${response.length}`);
    } catch (error) {
      setFeedback(String(error));
    }
  }

  async function loadActiveSessionMirror(actorId = form.mirrorViewerId, sessionId = session.sessionId) {
    const normalizedActorId = actorId.trim();
    if (!sessionId) {
      setFeedback('no hay sessionId para cargar el mirror');
      return;
    }
    if (!normalizedActorId) {
      setFeedback('define un actor viewer para cargar el mirror');
      return;
    }

    try {
      const response = await invoke<SessionMirrorSnapshot>('get_session_mirror_command', {
        request: {
          sessionId,
          actorId: normalizedActorId,
        },
      });
      setActiveMirror(response);
      setFeedback(`mirror cargado para ${normalizedActorId}`);
    } catch (error) {
      setFeedback(String(error));
    }
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

          <h3>Control Plane</h3>
          <div className="form-grid">
            <label>
              <span>Base URL</span>
              <input
                value={form.controlPlaneUrl}
                onChange={(event) => updateField('controlPlaneUrl', event.target.value)}
                placeholder="http://127.0.0.1:8080"
              />
            </label>
            <label>
              <span>Bearer Token</span>
              <input
                type="password"
                value={form.controlPlaneToken}
                onChange={(event) => updateField('controlPlaneToken', event.target.value)}
              />
            </label>
            <label>
              <span>Environment</span>
              <input
                value={form.controlPlaneEnvironment}
                onChange={(event) => updateField('controlPlaneEnvironment', event.target.value)}
              />
            </label>
            <label>
              <span>Principals CSV</span>
              <input
                value={form.controlPlanePrincipals}
                onChange={(event) => updateField('controlPlanePrincipals', event.target.value)}
                placeholder="ozy, admin"
              />
            </label>
            <label>
              <span>TTL (segundos)</span>
              <input
                value={form.controlPlaneTtlSeconds}
                onChange={(event) => updateField('controlPlaneTtlSeconds', event.target.value)}
              />
            </label>
            <label>
              <span>Renovar antes de</span>
              <input
                value={form.controlPlaneRenewBeforeSeconds}
                onChange={(event) => updateField('controlPlaneRenewBeforeSeconds', event.target.value)}
              />
            </label>
          </div>
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => void issueCertificate()}>
              Emitir Cert
            </button>
          </div>
          {issuedCertificate ? (
            <p className="hint">
              Cert {issuedCertificate.keyId} · vence {new Date(issuedCertificate.expiresAt * 1000).toLocaleString()}
            </p>
          ) : null}

          <h3>Relay CGNAT</h3>
          <div className="form-grid">
            <label>
              <span>Relay URL</span>
              <input
                value={form.relayUrl}
                onChange={(event) => updateField('relayUrl', event.target.value)}
                placeholder="auto si usas control-plane"
              />
            </label>
            <label>
              <span>Token</span>
              <input
                value={form.relayToken}
                onChange={(event) => updateField('relayToken', event.target.value)}
                placeholder="auto si usas control-plane"
              />
            </label>
            <label>
              <span>Target Node</span>
              <input
                value={form.relayTargetNodeId}
                onChange={(event) => updateField('relayTargetNodeId', event.target.value)}
              />
            </label>
          </div>
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => void issueRelayLease()}>
              Emitir Lease
            </button>
          </div>
          {issuedRelayLease ? (
            <p className="hint">
              Relay {issuedRelayLease.targetNodeId} via {issuedRelayLease.relayAddress} · vence{' '}
              {new Date(issuedRelayLease.expiresAt * 1000).toLocaleString()}
            </p>
          ) : null}

          <h3>Collaborative Mirror</h3>
          <div className="form-grid">
            <label>
              <span>Mirror Owner</span>
              <input
                value={form.mirrorOwnerId}
                onChange={(event) => updateField('mirrorOwnerId', event.target.value)}
                placeholder="local-operator"
              />
            </label>
            <label>
              <span>Mirror Viewer</span>
              <input
                value={form.mirrorViewerId}
                onChange={(event) => updateField('mirrorViewerId', event.target.value)}
                placeholder="auditor-1"
              />
            </label>
          </div>
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => void shareActiveSessionMirror()}>
              Compartir Mirror
            </button>
            <button type="button" className="secondary" onClick={() => void loadSessionMirrors()}>
              Listar Mirrors
            </button>
            <button type="button" className="secondary" onClick={() => void loadActiveSessionMirror()}>
              Cargar Mirror
            </button>
          </div>
          {sessionMirrors.length > 0 ? (
            <div className="vault-list">
              {sessionMirrors.map((mirror) => (
                <button
                  key={mirror.sessionId}
                  type="button"
                  className="vault-item"
                  onClick={() => void loadActiveSessionMirror(form.mirrorViewerId, mirror.sessionId)}
                >
                  <strong>{mirror.targetLabel}</strong>
                  <span>{mirror.ownerActorId} · {mirror.status}</span>
                </button>
              ))}
            </div>
          ) : null}

          <h3>Shared Vault</h3>
          <div className="form-grid">
            <label>
              <span>Parent Node</span>
              <input
                value={form.sharedVaultParentId}
                onChange={(event) => updateField('sharedVaultParentId', event.target.value)}
                placeholder="root"
              />
            </label>
            <label>
              <span>Node ID</span>
              <input
                value={form.sharedVaultNodeId}
                onChange={(event) => updateField('sharedVaultNodeId', event.target.value)}
                placeholder="auto si es nuevo"
              />
            </label>
            <label className="full-width">
              <span>Actor ACL</span>
              <input
                value={form.sharedVaultActorId}
                onChange={(event) => updateField('sharedVaultActorId', event.target.value)}
                placeholder="local-operator"
              />
            </label>
          </div>
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => void bootstrapSharedVault()}>
              Generar Demo
            </button>
            <button type="button" className="secondary" onClick={() => void loadSharedVault()}>
              Cargar Shared Vault
            </button>
            <button type="button" className="secondary" onClick={() => void listSharedVaultEntries()}>
              Resolver ACL
            </button>
            <button type="button" className="secondary" onClick={() => void upsertSharedVaultServer()}>
              Guardar Servidor
            </button>
            <button type="button" className="secondary" onClick={() => void deleteSharedVaultNode()}>
              Eliminar Nodo
            </button>
            <button type="button" className="secondary" onClick={() => void loadCollabAudit()}>
              Ver Audit
            </button>
          </div>
          {sharedVault ? (
            <p className="hint">
              {sharedVault.vault.name} · v{sharedVault.vault.version} · {sharedVault.vaultPath}
            </p>
          ) : null}
          {sharedVaultEntries.length > 0 ? (
            <div className="vault-list">
              {sharedVaultEntries.map((entry) => (
                <button
                  key={entry.nodeId}
                  type="button"
                  className="vault-item"
                  onClick={() => applySharedVaultEntry(entry)}
                >
                  <strong>{entry.name}</strong>
                  <span>{entry.username}@{entry.host}:{entry.port}</span>
                  <span>{entry.effectiveActions.join(', ')}</span>
                </button>
              ))}
            </div>
          ) : null}
          {collabAuditPath ? <p className="hint mono">{collabAuditPath}</p> : null}
          {collabAuditEntries.length > 0 ? (
            <div className="vault-list">
              {collabAuditEntries.map((entry) => (
                <div key={entry.eventId} className="vault-item">
                  <strong>{entry.eventType}</strong>
                  <span>{entry.actorId} · {entry.targetKind}</span>
                  <span>{entry.summary}</span>
                </div>
              ))}
            </div>
          ) : null}

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
            <label className="full-width">
              <span>Nueva Master Password</span>
              <input
                type="password"
                value={nextVaultPassword}
                onChange={(event) => setNextVaultPassword(event.target.value)}
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
            <button type="button" className="secondary" onClick={() => void rotateVaultPassword()}>
              Rotar Password
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
          {activeMirror ? <MirrorInspector snapshot={activeMirror} /> : null}
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

function MirrorInspector({ snapshot }: { snapshot: SessionMirrorSnapshot }) {
  return (
    <section className="mirror-panel">
      <h2>Mirror Read-Only</h2>
      <p>
        {snapshot.targetLabel} · {snapshot.status}
      </p>
      <p className="hint">
        Owner: {snapshot.ownerActorId} · Participantes: {snapshot.participants.length}
      </p>
      <pre className="mirror-transcript">{snapshot.transcript || '[sin salida todavia]'}</pre>
    </section>
  );
}

function upsertEntry(entries: VaultEntry[], next: VaultEntry) {
  const matchIndex = entries.findIndex((entry) => entry.name === next.name || entry.id === next.id);
  if (matchIndex === -1) {
    return [...entries, next];
  }

  return entries.map((entry, index) => (index === matchIndex ? { ...next, id: entry.id } : entry));
}

function splitList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toPositiveNumber(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}
