import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TerminalView } from './components/TerminalView';
import { useTerminalSession } from './hooks/useTerminalSession';
import type {
  CollabAuditEntriesResponse,
  ControlPlaneConfig,
  InspectImportedCredentialResponse,
  KnownHostEntry,
  LocalDirectoryEntry,
  LocalDirectoryResponse,
  LocalVaultResponse,
  ProbeHostKeyResponse,
  RecentConnectionEntry,
  RecentConnectionsResponse,
  RelayHint,
  ResolvedRelayLease,
  ResolvedSshCertificate,
  SessionMirrorSnapshot,
  SessionMirrorSummary,
  SharedVaultEntriesResponse,
  SharedVaultResponse,
  SharedVaultServerView,
  TerminalErrorKind,
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

type ActiveSessionLaunch = {
  launchId: string;
  request: SshSessionRequest;
  startedAt: number;
};

type KeychainItem = {
  id: string;
  name: string;
  environment: string;
  privateKeyPem: string;
  certificatePem: string;
  algorithm?: string;
  summary: string;
};

type ForwardingItem = {
  id: string;
  name: string;
  targetNodeId: string;
  relayUrl: string;
  relayToken: string;
  requestedPort: string;
  purpose: string;
  leaseId?: string;
};

type SnippetItem = {
  id: string;
  name: string;
  command: string;
  description: string;
};

type ComposerSection = 'hosts' | 'keychain' | 'port-forwarding' | 'snippets' | null;
type BrowserMenuSubmenu = 'edit' | 'view' | 'window' | 'help' | null;
type AppIconName = 'vaults' | 'sftp' | 'hosts' | 'keychain' | 'port-forwarding' | 'snippets' | 'known-hosts' | 'logs' | 'person' | 'team';

type WorkspaceView = 'terminal' | 'hosts' | 'vaults' | 'relay' | 'collab';
type VaultSection = 'hosts' | 'keychain' | 'port-forwarding' | 'snippets' | 'known-hosts' | 'logs';

const workspaceMeta: Record<WorkspaceView, { label: string; eyebrow: string; description: string }> = {
  terminal: {
    label: 'Terminal',
    eyebrow: 'Live Session',
    description: 'Vista principal de trabajo con la sesion activa, accesos rapidos y estado operativo.',
  },
  hosts: {
    label: 'Hosts',
    eyebrow: 'Connection Profiles',
    description: 'Perfiles SSH, identidad, host trust y material criptografico del operador.',
  },
  vaults: {
    label: 'Vaults',
    eyebrow: 'Secrets And ACL',
    description: 'Vault local cifrado y shared vault separados del flujo interactivo del terminal.',
  },
  relay: {
    label: 'Relay',
    eyebrow: 'Control Plane',
    description: 'Certificados efimeros, leases relay y reachability para nodos detras de CGNAT.',
  },
  collab: {
    label: 'Collaboration',
    eyebrow: 'Mirror And Audit',
    description: 'Session mirror, actores compartidos y auditoria colaborativa en paneles dedicados.',
  },
};

const themePresets = [
  { name: 'Termius Dark', meta: 'co', accentClass: 'theme-accent-green', isActive: true },
  { name: 'Hacker Green', meta: '10955', accentClass: 'theme-accent-lime', isActive: false },
  { name: 'Kanagawa Wave', meta: '18228', accentClass: 'theme-accent-indigo', isActive: false },
  { name: 'Flexoki Dark', meta: 'new', accentClass: 'theme-accent-amber', isActive: false },
  { name: 'Dracula', meta: '15922', accentClass: 'theme-accent-pink', isActive: false },
  { name: 'One Dark Pro', meta: '2208', accentClass: 'theme-accent-blue', isActive: false },
];

const shellNavigation: Array<{ id: VaultSection; label: string; icon: AppIconName }> = [
  { id: 'hosts', label: 'Hosts', icon: 'hosts' },
  { id: 'keychain', label: 'Keychain', icon: 'keychain' },
  { id: 'port-forwarding', label: 'Port Forwarding', icon: 'port-forwarding' },
  { id: 'snippets', label: 'Snippets', icon: 'snippets' },
  { id: 'known-hosts', label: 'Known Hosts', icon: 'known-hosts' },
  { id: 'logs', label: 'Logs', icon: 'logs' },
];

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

const appWindow = getCurrentWindow();

function formatSftpDate(timestamp?: number) {
  if (!timestamp) {
    return '--';
  }

  return new Date(timestamp * 1000).toLocaleString();
}

function formatSftpSize(sizeBytes?: number) {
  if (sizeBytes == null) {
    return '--';
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} Bytes`;
  }

  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = sizeBytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

function buildSftpBreadcrumbs(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/');
  const trimmed = normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  const [drive, ...segments] = trimmed.split('/').filter(Boolean);
  const breadcrumbs = [{ label: drive || 'Root', path: drive ? `${drive}/` : '/' }];
  let currentPath = drive ? `${drive}/` : '/';

  segments.forEach((segment) => {
    currentPath = `${currentPath}${segment}/`;
    breadcrumbs.push({ label: segment, path: currentPath });
  });

  return breadcrumbs;
}

export default function App() {
  const session = useTerminalSession();
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceView>('terminal');
  const [isTerminalTabOpen, setIsTerminalTabOpen] = useState(true);
  const [activeVaultSection, setActiveVaultSection] = useState<VaultSection>('hosts');
  const [isVaultSidebarOpen, setIsVaultSidebarOpen] = useState(true);
  const [isVaultMenuOpen, setIsVaultMenuOpen] = useState(false);
  const [isBrowserMenuOpen, setIsBrowserMenuOpen] = useState(false);
  const [activeBrowserSubmenu, setActiveBrowserSubmenu] = useState<BrowserMenuSubmenu>(null);
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [activeVaultScope, setActiveVaultScope] = useState<'personal' | 'team'>('personal');
  const [titlebarSearch, setTitlebarSearch] = useState('');
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [isWindowFocused, setIsWindowFocused] = useState(true);
  const [form, setForm] = useState<FormState>(initialForm);
  const [activeLaunch, setActiveLaunch] = useState<ActiveSessionLaunch | null>(null);
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
  const [knownHosts, setKnownHosts] = useState<KnownHostEntry[]>([]);
  const [discoveredHostKey, setDiscoveredHostKey] = useState<ProbeHostKeyResponse | null>(null);
  const [recentConnections, setRecentConnections] = useState<RecentConnectionEntry[]>([]);
  const [recentHistoryPath, setRecentHistoryPath] = useState('');
  const [importedPrivateKey, setImportedPrivateKey] = useState<InspectImportedCredentialResponse | null>(null);
  const [importedCertificate, setImportedCertificate] = useState<InspectImportedCredentialResponse | null>(null);
  const [activeComposer, setActiveComposer] = useState<ComposerSection>(null);
  const [keychainItems, setKeychainItems] = useState<KeychainItem[]>([]);
  const [forwardingItems, setForwardingItems] = useState<ForwardingItem[]>([]);
  const [snippetItems, setSnippetItems] = useState<SnippetItem[]>([]);
  const [snippetDraftName, setSnippetDraftName] = useState('');
  const [snippetDraftCommand, setSnippetDraftCommand] = useState('');
  const [snippetDraftDescription, setSnippetDraftDescription] = useState('');
  const [sftpLocalPath, setSftpLocalPath] = useState('C:/');
  const [sftpLocalParentPath, setSftpLocalParentPath] = useState<string | null>(null);
  const [sftpLocalEntries, setSftpLocalEntries] = useState<LocalDirectoryEntry[]>([]);
  const [isSftpShowingHidden, setIsSftpShowingHidden] = useState(false);
  const [isSftpLocalLoading, setIsSftpLocalLoading] = useState(false);
  const [sftpLocalError, setSftpLocalError] = useState<string | null>(null);
  const [sftpLocalReloadToken, setSftpLocalReloadToken] = useState(0);
  const [feedback, setFeedback] = useState('vault local listo');
  const credentialFileInputRef = useRef<HTMLInputElement | null>(null);
  const browserMenuRef = useRef<HTMLDivElement | null>(null);
  const vaultMenuRef = useRef<HTMLDivElement | null>(null);

  const visibleSftpLocalEntries = useMemo(() => {
    if (isSftpShowingHidden) {
      return sftpLocalEntries;
    }

    return sftpLocalEntries.filter((entry) => !entry.name.startsWith('.'));
  }, [isSftpShowingHidden, sftpLocalEntries]);

  useEffect(() => {
    void loadRecentConnections();
  }, []);

  useEffect(() => {
    if (session.status === 'connected') {
      const timer = window.setTimeout(() => {
        void loadRecentConnections();
      }, 300);
      return () => window.clearTimeout(timer);
    }
  }, [session.status]);

  useEffect(() => {
    let cancelled = false;

    const loadLocalDirectory = async () => {
      setIsSftpLocalLoading(true);
      setSftpLocalError(null);

      try {
        const response = await invoke<LocalDirectoryResponse>('list_local_directory_command', {
          path: sftpLocalPath,
        });

        if (cancelled) {
          return;
        }

        setSftpLocalEntries(response.entries);
        setSftpLocalParentPath(response.parentPath ?? null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setSftpLocalEntries([]);
        setSftpLocalParentPath(null);
        setSftpLocalError(String(error));
      } finally {
        if (!cancelled) {
          setIsSftpLocalLoading(false);
        }
      }
    };

    void loadLocalDirectory();

    return () => {
      cancelled = true;
    };
  }, [sftpLocalPath, sftpLocalReloadToken]);

  useEffect(() => {
    let ignore = false;
    const cleanup: Array<() => void> = [];

    const syncWindowState = async () => {
      try {
        const maximized = await appWindow.isMaximized();
        if (!ignore) {
          setIsWindowMaximized(maximized);
        }
      } catch {
        if (!ignore) {
          setIsWindowMaximized(false);
        }
      }
    };

    void syncWindowState();

    void appWindow
      .onResized(() => {
        void syncWindowState();
      })
      .then((unlisten) => cleanup.push(unlisten))
      .catch(() => {});

    void appWindow
      .onFocusChanged(({ payload }) => {
        if (!ignore) {
          setIsWindowFocused(payload);
        }
      })
      .then((unlisten) => cleanup.push(unlisten))
      .catch(() => {});

    return () => {
      ignore = true;
      cleanup.forEach((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    if (!isVaultMenuOpen && !isBrowserMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const insideVaultMenu = vaultMenuRef.current?.contains(target);
      const insideBrowserMenu = browserMenuRef.current?.contains(target);

      if (!insideVaultMenu) {
        setIsVaultMenuOpen(false);
      }

      if (!insideBrowserMenu) {
        setIsBrowserMenuOpen(false);
        setActiveBrowserSubmenu(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isBrowserMenuOpen, isVaultMenuOpen]);

  useEffect(() => {
    if (!isBrowserMenuOpen && !isSettingsPanelOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      setIsBrowserMenuOpen(false);
      setActiveBrowserSubmenu(null);
      setIsSettingsPanelOpen(false);
      setIsVaultMenuOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isBrowserMenuOpen, isSettingsPanelOpen]);

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

  const draftSessionRequest = useMemo(
    () => buildSessionRequest(form, activeRelay, activeControlPlane),
    [activeControlPlane, activeRelay, form],
  );

  const pendingSessionChanges = useMemo(() => {
    if (!activeLaunch) {
      return [];
    }

    return describeStructuralSessionChanges(activeLaunch.request, draftSessionRequest);
  }, [activeLaunch, draftSessionRequest]);

  const currentKnownHost = useMemo(
    () => findKnownHost(knownHosts, form.host, Number(form.port || 22)),
    [form.host, form.port, knownHosts],
  );

  const filteredVaultEntries = useMemo(() => {
    const query = titlebarSearch.trim().toLowerCase();
    if (!query) {
      return vaultEntries;
    }

    return vaultEntries.filter((entry) => {
      const haystack = [entry.name, entry.host, entry.username, entry.relayHint?.targetNodeId]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [titlebarSearch, vaultEntries]);

  const filteredRecentConnections = useMemo(() => {
    const query = titlebarSearch.trim().toLowerCase();
    if (!query) {
      return recentConnections;
    }

    return recentConnections.filter((entry) => {
      const haystack = [entry.profileName, entry.host, entry.username, entry.environment, entry.relayTargetNodeId]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [recentConnections, titlebarSearch]);

  const filteredKnownHosts = useMemo(() => {
    const query = titlebarSearch.trim().toLowerCase();
    if (!query) {
      return knownHosts;
    }

    return knownHosts.filter((entry) => {
      const haystack = [entry.label, entry.host, entry.fingerprintSha256, String(entry.port)].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [knownHosts, titlebarSearch]);

  const statusSummary = useMemo(() => {
    if (activeLaunch) {
      return `${activeLaunch.request.username}@${activeLaunch.request.host}:${activeLaunch.request.port}`;
    }

    return `${form.username || 'operator'}@${form.host || 'host'}:${form.port || '22'}`;
  }, [activeLaunch, form.host, form.port, form.username]);

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function minimizeWindow() {
    try {
      await appWindow.minimize();
    } catch {
      setFeedback('no fue posible minimizar la ventana');
    }
  }

  async function toggleWindowMaximize() {
    try {
      await appWindow.toggleMaximize();
      setIsWindowMaximized(await appWindow.isMaximized());
    } catch {
      setFeedback('no fue posible cambiar el estado maximizado');
    }
  }

  async function closeWindow() {
    try {
      await appWindow.close();
    } catch {
      setFeedback('no fue posible cerrar la ventana');
    }
  }

  function handleTitlebarDoubleClick(event: React.MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest('[data-no-drag="true"]')) {
      return;
    }

    void toggleWindowMaximize();
  }

  function startNewConnection() {
    setIsTerminalTabOpen(true);
    setActiveWorkspace('terminal');
    setActiveLaunch(null);
    setForm({
      ...initialForm,
      name: '',
      host: '',
      username: '',
      privateKeyPem: '',
      privateKeyPassphrase: '',
      certificatePem: '',
      knownHostFingerprint: '',
      relayUrl: '',
      relayToken: '',
      relayTargetNodeId: '',
    });
    setActiveComposer(null);
    setIssuedCertificate(null);
    setIssuedRelayLease(null);
    setDiscoveredHostKey(null);
    setImportedPrivateKey(null);
    setImportedCertificate(null);
    setFeedback('nueva conexion ssh lista para configurar');
  }

  function closeActiveTerminalTab(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setIsTerminalTabOpen(false);
    setActiveLaunch(null);
    setActiveWorkspace('vaults');
    setIsVaultSidebarOpen(true);
    setFeedback('sesion ssh cerrada');
  }

  function handleTerminalTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setActiveWorkspace('terminal');
    }
  }

  function closeBrowserMenu() {
    setIsBrowserMenuOpen(false);
    setActiveBrowserSubmenu(null);
  }

  function openVaultWorkspace() {
    setActiveWorkspace('vaults');
    setIsVaultSidebarOpen(true);
  }

  function openSftpWorkspace() {
    setActiveWorkspace('hosts');
    setFeedback('vista sftp lista');
  }

  function openSftpHostSelector() {
    setActiveWorkspace('vaults');
    setActiveVaultSection('hosts');
    setIsVaultSidebarOpen(true);
    setFeedback('selecciona un host guardado para usarlo en sftp');
  }

  function navigateSftpLocalPath(nextPath: string) {
    setSftpLocalPath(nextPath);
  }

  function navigateSftpLocalUp() {
    if (!sftpLocalParentPath) {
      return;
    }

    setSftpLocalPath(sftpLocalParentPath);
  }

  function refreshSftpLocalDirectory() {
    setSftpLocalReloadToken((currentToken) => currentToken + 1);
    setFeedback(`directorio local actualizado: ${sftpLocalPath}`);
  }

  function toggleSftpHiddenEntries() {
    setIsSftpShowingHidden((currentValue) => {
      const nextValue = !currentValue;
      setFeedback(nextValue ? 'mostrando archivos ocultos' : 'ocultando archivos ocultos');
      return nextValue;
    });
  }

  function openRelayWorkspace() {
    setActiveWorkspace('relay');
    setFeedback('serial y relay listos para configurar');
  }

  function openCollabWorkspace() {
    setActiveWorkspace('collab');
    setFeedback('panel colaborativo abierto');
  }

  function openSettingsPanel() {
    setIsSettingsPanelOpen(true);
    closeBrowserMenu();
    setFeedback('configuracion general abierta');
  }

  function toggleVaultSidebar() {
    if (activeWorkspace !== 'vaults') {
      openVaultWorkspace();
      setIsVaultMenuOpen(false);
      return;
    }

    setIsVaultSidebarOpen((current) => {
      const next = !current;
      if (!next) {
        setIsVaultMenuOpen(false);
      }
      return next;
    });
  }

  function toggleBrowserMenu() {
    setIsBrowserMenuOpen((current) => {
      const next = !current;

      if (!next) {
        setActiveBrowserSubmenu(null);
      }

      return next;
    });
    setIsVaultMenuOpen(false);
  }

  function toggleVaultMenu() {
    if (activeWorkspace !== 'vaults') {
      openVaultWorkspace();
      setIsVaultMenuOpen(true);
      return;
    }

    closeBrowserMenu();
    setIsVaultMenuOpen((current) => !current);
  }

  function selectVaultScope(scope: 'personal' | 'team') {
    setActiveVaultScope(scope);
    setIsVaultMenuOpen(false);
    setFeedback(scope === 'personal' ? 'vault personal activo' : 'vault team activo');
  }

  function selectVaultSection(section: VaultSection) {
    openVaultWorkspace();
    setActiveVaultSection(section);
    setActiveComposer(null);

    if (section === 'logs') {
      void loadRecentConnections();
    }

    if (section === 'known-hosts') {
      void loadVault();
    }
  }

  function openSerialWorkspace() {
    openRelayWorkspace();
    closeBrowserMenu();
  }

  function handleBrowserMenuAction(action: () => void | Promise<void>) {
    closeBrowserMenu();
    void action();
  }

  function handleClearSearch() {
    setTitlebarSearch('');
    setFeedback('busqueda de la barra superior limpiada');
  }

  function handleResetConnectionDraft() {
    setForm(initialForm);
    setFeedback('conexion borrador restablecida');
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

  function loadEntry(entry: VaultEntry) {
    const knownHost = findKnownHost(knownHosts, entry.host, entry.port);
    setForm({
      name: entry.name,
      host: entry.host,
      port: String(entry.port),
      username: entry.username,
      knownHostFingerprint: entry.knownHostFingerprint ?? knownHost?.fingerprintSha256 ?? '',
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
    setDiscoveredHostKey(null);
    setImportedPrivateKey(null);
    setImportedCertificate(null);
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

  function openCredentialPicker() {
    credentialFileInputRef.current?.click();
  }

  async function importCredentialFiles(files: FileList | null, input: HTMLInputElement) {
    const selectedFiles = Array.from(files ?? []);
    input.value = '';

    if (!selectedFiles.length) {
      return;
    }

    let nextPrivateKey: InspectImportedCredentialResponse | null = null;
    let nextCertificate: InspectImportedCredentialResponse | null = null;
    const messages: string[] = [];

    for (const file of selectedFiles) {
      try {
        const content = await file.text();
        const imported = await invoke<InspectImportedCredentialResponse>(
          'inspect_imported_credential_command',
          {
            request: {
              content,
              filename: file.name,
              passphrase: form.privateKeyPassphrase.trim() || undefined,
            },
          },
        );

        if (imported.kind === 'private_key') {
          nextPrivateKey = imported;
          messages.push(`${file.name}: ${imported.summary}`);
        } else {
          nextCertificate = imported;
          messages.push(`${file.name}: ${imported.summary}`);
        }
      } catch (error) {
        messages.push(`${file.name}: ${String(error)}`);
      }
    }

    if (!nextPrivateKey && !nextCertificate) {
      setFeedback(messages.join(' | ') || 'no se importó ninguna credencial válida');
      return;
    }

    setForm((current) => {
      const next = { ...current };
      if (nextPrivateKey) {
        next.privateKeyPem = nextPrivateKey.normalizedContent;
        if (!nextCertificate) {
          next.certificatePem = '';
        }
      }
      if (nextCertificate) {
        next.certificatePem = nextCertificate.normalizedContent;
      }
      return next;
    });

    if (nextPrivateKey) {
      setImportedPrivateKey(nextPrivateKey);
      setIssuedCertificate(null);
      if (!nextCertificate) {
        setImportedCertificate(null);
      }
    }
    if (nextCertificate) {
      setImportedCertificate(nextCertificate);
      setIssuedCertificate(null);
    }

    setFeedback(messages.join(' | '));
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
          knownHosts,
        },
      });

      setVaultEntries(response.entries);
      setKnownHosts(response.knownHosts);
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
      setKnownHosts(response.knownHosts);
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
      setKnownHosts(response.knownHosts);
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

    const expectedHostFingerprint =
      form.knownHostFingerprint.trim() ||
      findKnownHost(knownHosts, form.host, Number(form.port || 22))?.fingerprintSha256 ||
      '';

    if (!expectedHostFingerprint) {
      setFeedback('define la fingerprint SHA-256 o la host key OpenSSH antes de conectar');
      return;
    }

    const nextRequest: SshSessionRequest = {
      ...draftSessionRequest,
      knownHostFingerprint: expectedHostFingerprint,
    };

    updateField('knownHostFingerprint', expectedHostFingerprint);

    if (activeLaunch && structurallyEquivalentSessionRequest(activeLaunch.request, nextRequest)) {
      setIsTerminalTabOpen(true);
      setActiveWorkspace('terminal');
      setFeedback('la sesion actual ya usa este perfil');
      return;
    }

    setIsTerminalTabOpen(true);
    setActiveLaunch({
      launchId: crypto.randomUUID(),
      request: nextRequest,
      startedAt: Date.now(),
    });
    setActiveWorkspace('terminal');
    setFeedback(
      activeLaunch
        ? `reconectando con cambios en ${pendingSessionChanges.join(', ') || 'la sesion'}`
        : `abriendo sesion: ${nextRequest.username}@${nextRequest.host}:${nextRequest.port}`,
    );
  }

  async function issueRelayLease() {
    if (!activeControlPlane) {
      setFeedback('define la URL del control-plane para emitir un relay lease');
      return;
    }

    if (!form.relayTargetNodeId.trim()) {
      setFeedback('define el target node para solicitar port forwarding');
      return;
    }

    try {
      const response = await invoke<ResolvedRelayLease>('issue_relay_lease_command', {
        request: {
          targetNodeId: form.relayTargetNodeId.trim(),
          requestedPort: Number(form.port || 22),
          purpose: `ssh:${form.host || form.relayTargetNodeId.trim()}`,
          controlPlane: activeControlPlane,
        },
      });

      setIssuedRelayLease(response);
      updateField('relayUrl', response.relayAddress);
      updateField('relayToken', response.token);
      setFeedback(`relay lease emitido: ${response.leaseId}`);
    } catch (error) {
      setFeedback(String(error));
    }
  }

  async function probeHostKey() {
    if (!form.host.trim()) {
      setFeedback('define el host antes de descubrir su host key');
      return;
    }

    try {
      const response = await invoke<ProbeHostKeyResponse>('probe_ssh_host_key_command', {
        request: {
          host: form.host.trim(),
          port: Number(form.port || 22),
        },
      });

      setDiscoveredHostKey(response);
      setFeedback(`host key descubierta: ${response.fingerprintSha256}`);
    } catch (error) {
      setFeedback(String(error));
    }
  }

  function trustDiscoveredHostKey() {
    if (!discoveredHostKey) {
      setFeedback('primero descubre una host key');
      return;
    }

    const nextKnownHost: KnownHostEntry = {
      host: discoveredHostKey.host,
      port: discoveredHostKey.port,
      fingerprintSha256: discoveredHostKey.fingerprintSha256,
      hostKeyOpenssh: discoveredHostKey.hostKeyOpenssh,
      addedAt: discoveredHostKey.discoveredAt,
      label: form.name || `${discoveredHostKey.host}:${discoveredHostKey.port}`,
    };

    setKnownHosts((current) => upsertKnownHost(current, nextKnownHost));
    updateField('knownHostFingerprint', nextKnownHost.fingerprintSha256);
    setFeedback(`known_host confiado: ${nextKnownHost.fingerprintSha256}`);
  }

  function applyKnownHostForCurrentTarget() {
    const knownHost = findKnownHost(knownHosts, form.host, Number(form.port || 22));
    if (!knownHost) {
      setFeedback('no existe un known_host para el host y puerto actuales');
      return;
    }

    updateField('knownHostFingerprint', knownHost.fingerprintSha256);
    setFeedback(`known_host aplicado: ${knownHost.fingerprintSha256}`);
  }

  function openComposer(section: ComposerSection) {
    setActiveComposer(section);

    if (section === 'hosts' && !form.name.trim()) {
      updateField('name', `${form.username || 'operator'}@${form.host || 'host'}`);
    }
  }

  function closeComposer() {
    setActiveComposer(null);
  }

  async function createHostEntry() {
    if (!vaultPassword) {
      setFeedback('define una master password para guardar el host en vault');
      return;
    }

    await saveVault();
    setActiveComposer(null);
  }

  function createKeychainEntry() {
    if (!form.privateKeyPem.trim() && !form.certificatePem.trim()) {
      setFeedback('agrega una clave o certificado antes de guardar en keychain');
      return;
    }

    const nextItem: KeychainItem = {
      id: crypto.randomUUID(),
      name: form.name.trim() || `${form.username}@${form.host}`,
      environment: form.controlPlaneEnvironment.trim() || 'development',
      privateKeyPem: form.privateKeyPem,
      certificatePem: form.certificatePem,
      algorithm: importedPrivateKey?.algorithm || importedCertificate?.algorithm,
      summary: importedPrivateKey?.summary || importedCertificate?.summary || 'credencial manual',
    };

    setKeychainItems((current) => [nextItem, ...current.filter((item) => item.name !== nextItem.name)]);
    setActiveComposer(null);
    setFeedback(`item guardado en keychain: ${nextItem.name}`);
  }

  function loadKeychainItem(item: KeychainItem) {
    updateField('privateKeyPem', item.privateKeyPem);
    updateField('certificatePem', item.certificatePem);
    updateField('controlPlaneEnvironment', item.environment);
    setFeedback(`keychain cargado: ${item.name}`);
  }

  function createForwardingEntry() {
    if (!form.relayTargetNodeId.trim()) {
      setFeedback('define el target node antes de guardar un forwarding');
      return;
    }

    const nextItem: ForwardingItem = {
      id: crypto.randomUUID(),
      name: form.name.trim() || `Forward ${form.relayTargetNodeId.trim()}`,
      targetNodeId: form.relayTargetNodeId.trim(),
      relayUrl: form.relayUrl.trim(),
      relayToken: form.relayToken.trim(),
      requestedPort: form.port,
      purpose: `ssh:${form.host || form.relayTargetNodeId.trim()}`,
      leaseId: issuedRelayLease?.leaseId,
    };

    setForwardingItems((current) => [nextItem, ...current.filter((item) => item.name !== nextItem.name)]);
    setActiveComposer(null);
    setFeedback(`forwarding guardado: ${nextItem.name}`);
  }

  function loadForwardingEntry(item: ForwardingItem) {
    updateField('relayTargetNodeId', item.targetNodeId);
    updateField('relayUrl', item.relayUrl);
    updateField('relayToken', item.relayToken);
    updateField('port', item.requestedPort);
    setFeedback(`forwarding cargado: ${item.name}`);
  }

  function createSnippetEntry() {
    if (!snippetDraftName.trim() || !snippetDraftCommand.trim()) {
      setFeedback('define nombre y comando para guardar el snippet');
      return;
    }

    const nextItem: SnippetItem = {
      id: crypto.randomUUID(),
      name: snippetDraftName.trim(),
      command: snippetDraftCommand.trim(),
      description: snippetDraftDescription.trim(),
    };

    setSnippetItems((current) => [nextItem, ...current.filter((item) => item.name !== nextItem.name)]);
    setSnippetDraftName('');
    setSnippetDraftCommand('');
    setSnippetDraftDescription('');
    setActiveComposer(null);
    setFeedback(`snippet guardado: ${nextItem.name}`);
  }

  function loadSnippetEntry(item: SnippetItem) {
    setFeedback(`snippet seleccionado: ${item.command}`);
  }

  function renderVaultHostsSection() {
    const isEmpty = filteredVaultEntries.length === 0 && activeComposer !== 'hosts';

    if (isEmpty) {
      return (
        <div className="vault-section-layout single-column">
          <section className="vault-empty-panel">
            <div className="vault-empty-icon">◎</div>
            <h3>Create</h3>
            <p>Cuando agregues algo aparecerá aquí para seleccionarlo fácilmente.</p>
            <button type="button" className="command-chip primary" onClick={() => openComposer('hosts')}>
              Create
            </button>
          </section>
        </div>
      );
    }

    return (
      <div className="vault-section-layout">
        <section className="stack-card">
          <SectionHeading
            title={activeVaultScope === 'personal' ? 'Personal Hosts' : 'Team Hosts'}
            subtitle="Perfiles SSH persistidos dentro del vault activo y listos para abrirse."
          />
          {activeComposer === 'hosts' ? (
            <section className="vault-composer-panel">
              <div className="pane-grid cols-2">
                <label className="full-width">
                  <span>Master Password</span>
                  <input type="password" value={vaultPassword} onChange={(event) => setVaultPassword(event.target.value)} />
                </label>
                <label className="full-width">
                  <span>Nueva Master Password</span>
                  <input type="password" value={nextVaultPassword} onChange={(event) => setNextVaultPassword(event.target.value)} />
                </label>
                <label>
                  <span>Perfil</span>
                  <input value={form.name} onChange={(event) => updateField('name', event.target.value)} />
                </label>
                <label>
                  <span>Usuario</span>
                  <input value={form.username} onChange={(event) => updateField('username', event.target.value)} />
                </label>
                <label>
                  <span>Host</span>
                  <input value={form.host} onChange={(event) => updateField('host', event.target.value)} />
                </label>
                <label>
                  <span>Puerto</span>
                  <input value={form.port} onChange={(event) => updateField('port', event.target.value)} />
                </label>
              </div>
              <div className="button-row">
                <button type="button" className="secondary" onClick={() => void loadVault()}>
                  Cargar Vault
                </button>
                <button type="button" className="secondary" onClick={() => void rotateVaultPassword()}>
                  Rotar Password
                </button>
                <button type="button" className="secondary" onClick={closeComposer}>
                  Cancelar
                </button>
                <button type="button" className="primary" onClick={() => void createHostEntry()}>
                  Guardar Host
                </button>
              </div>
            </section>
          ) : null}
          <div className="vault-card-list selectable-list">
            {filteredVaultEntries.length > 0 ? (
              filteredVaultEntries.map((entry) => (
                <button key={entry.id} type="button" className="vault-host-card" onClick={() => loadEntry(entry)}>
                  <span className="vault-host-card-badge">◎</span>
                  <span className="vault-host-card-copy">
                    <strong>{entry.name}</strong>
                    <span>{entry.host}</span>
                    <span>{entry.username}@{entry.host}:{entry.port}</span>
                  </span>
                </button>
              ))
            ) : (
              <EmptyState text="No hay hosts guardados todavia en el vault activo." />
            )}
          </div>
        </section>

        <section className="stack-card">
          <SectionHeading title="Shared Vault" subtitle="ACL, servidores compartidos y revision colaborativa" />
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
          </div>
          {sharedVault ? (
            <div className="info-banner">
              <strong>{sharedVault.vault.name}</strong>
              <span>v{sharedVault.vault.version}</span>
              <span>{sharedVault.vaultPath}</span>
            </div>
          ) : null}
          <div className="vault-list">
            {sharedVaultEntries.length > 0 ? (
              sharedVaultEntries.map((entry) => (
                <button key={entry.nodeId} type="button" className="vault-item" onClick={() => applySharedVaultEntry(entry)}>
                  <strong>{entry.name}</strong>
                  <span>{entry.username}@{entry.host}:{entry.port}</span>
                  <span>{entry.effectiveActions.join(', ')}</span>
                </button>
              ))
            ) : (
              <EmptyState text="Sin servidores compartidos visibles para el actor actual." />
            )}
          </div>
        </section>
      </div>
    );
  }

  function renderVaultKeychainSection() {
    const isEmpty = keychainItems.length === 0 && activeComposer !== 'keychain';

    if (isEmpty) {
      return (
        <div className="vault-section-layout single-column">
          <section className="vault-empty-panel">
            <div className="vault-empty-icon"><AppIcon name="keychain" /></div>
            <h3>Add credentials</h3>
            <p>Store your credentials to quick and securely access your servers.</p>
            <button type="button" className="command-chip primary" onClick={() => openComposer('keychain')}>
              Create
            </button>
          </section>
        </div>
      );
    }

    return (
      <div className="vault-section-layout single-column">
        <section className="stack-card">
          <SectionHeading title="Keychain" subtitle="Claves privadas, certificados y material de autenticacion para accesos rapidos." />
          {activeComposer === 'keychain' ? (
            <section className="vault-composer-panel">
              <div className="pane-grid cols-2">
                <label>
                  <span>Passphrase</span>
                  <input
                    type="password"
                    value={form.privateKeyPassphrase}
                    onChange={(event) => updateField('privateKeyPassphrase', event.target.value)}
                  />
                </label>
                <label>
                  <span>Environment</span>
                  <input value={form.controlPlaneEnvironment} onChange={(event) => updateField('controlPlaneEnvironment', event.target.value)} />
                </label>
                <label className="full-width">
                  <span>Private Key PEM</span>
                  <textarea rows={9} value={form.privateKeyPem} onChange={(event) => updateField('privateKeyPem', event.target.value)} />
                </label>
                <label className="full-width">
                  <span>Certificado OpenSSH</span>
                  <textarea rows={4} value={form.certificatePem} onChange={(event) => updateField('certificatePem', event.target.value)} />
                </label>
              </div>
              <div className="button-row">
                <button type="button" className="secondary" onClick={openCredentialPicker}>
                  Importar Archivo(s)
                </button>
                <button type="button" className="secondary" onClick={() => void issueCertificate()}>
                  Emitir Certificado
                </button>
                <button type="button" className="secondary" onClick={closeComposer}>
                  Cancelar
                </button>
                <button type="button" className="primary" onClick={createKeychainEntry}>
                  Guardar Keychain
                </button>
              </div>
            </section>
          ) : null}
          <div className="vault-card-list selectable-list">
            {keychainItems.map((item) => (
              <button key={item.id} type="button" className="vault-host-card" onClick={() => loadKeychainItem(item)}>
                <span className="vault-host-card-badge"><AppIcon name="keychain" /></span>
                <span className="vault-host-card-copy">
                  <strong>{item.name}</strong>
                  <span>{item.environment}</span>
                  <span>{item.summary}</span>
                </span>
              </button>
            ))}
          </div>
          {importedPrivateKey ? <CredentialImportCard title="Private Key" report={importedPrivateKey} /> : null}
          {importedCertificate ? <CredentialImportCard title="Certificate" report={importedCertificate} /> : null}
        </section>
      </div>
    );
  }

  function renderVaultPortForwardingSection() {
    const isEmpty = forwardingItems.length === 0 && activeComposer !== 'port-forwarding';

    if (isEmpty) {
      return (
        <div className="vault-section-layout single-column">
          <section className="vault-empty-panel">
            <div className="vault-empty-icon"><AppIcon name="port-forwarding" /></div>
            <h3>Set up port forwarding</h3>
            <p>Save port forwarding to access databases, web apps, and other services.</p>
            <button type="button" className="command-chip primary" onClick={() => openComposer('port-forwarding')}>
              Create
            </button>
          </section>
        </div>
      );
    }

    return (
      <div className="vault-section-layout single-column">
        <section className="stack-card">
          <SectionHeading title="Port Forwarding" subtitle="Configura leases relay y accesos indirectos a servicios internos." />
          {activeComposer === 'port-forwarding' ? (
            <section className="vault-composer-panel">
              <div className="pane-grid cols-2">
                <label>
                  <span>Control Plane URL</span>
                  <input value={form.controlPlaneUrl} onChange={(event) => updateField('controlPlaneUrl', event.target.value)} placeholder="http://127.0.0.1:8080" />
                </label>
                <label>
                  <span>Bearer Token</span>
                  <input type="password" value={form.controlPlaneToken} onChange={(event) => updateField('controlPlaneToken', event.target.value)} />
                </label>
                <label>
                  <span>Relay URL</span>
                  <input value={form.relayUrl} onChange={(event) => updateField('relayUrl', event.target.value)} placeholder="auto si usas control-plane" />
                </label>
                <label>
                  <span>Relay Token</span>
                  <input value={form.relayToken} onChange={(event) => updateField('relayToken', event.target.value)} placeholder="auto si usas control-plane" />
                </label>
                <label className="full-width">
                  <span>Target Node</span>
                  <input value={form.relayTargetNodeId} onChange={(event) => updateField('relayTargetNodeId', event.target.value)} placeholder="demo-node-1" />
                </label>
              </div>
              <div className="button-row">
                <button type="button" className="secondary" onClick={() => void issueRelayLease()}>
                  Emitir Lease
                </button>
                <button type="button" className="secondary" onClick={closeComposer}>
                  Cancelar
                </button>
                <button type="button" className="primary" onClick={createForwardingEntry}>
                  Guardar Forwarding
                </button>
              </div>
            </section>
          ) : null}
          <div className="vault-card-list selectable-list">
            {forwardingItems.map((item) => (
              <button key={item.id} type="button" className="vault-host-card" onClick={() => loadForwardingEntry(item)}>
                <span className="vault-host-card-badge"><AppIcon name="port-forwarding" /></span>
                <span className="vault-host-card-copy">
                  <strong>{item.name}</strong>
                  <span>{item.targetNodeId}</span>
                  <span>{item.leaseId || item.relayUrl || 'draft relay route'}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  }

  function renderVaultSnippetsSection() {
    const isEmpty = snippetItems.length === 0 && activeComposer !== 'snippets';

    if (isEmpty) {
      return (
        <div className="vault-section-layout single-column">
          <section className="vault-empty-panel">
            <div className="vault-empty-icon"><AppIcon name="snippets" /></div>
            <h3>Create</h3>
            <p>Cuando agregues algo aparecerá aquí para seleccionarlo fácilmente.</p>
            <button type="button" className="command-chip primary" onClick={() => openComposer('snippets')}>
              Create
            </button>
          </section>
        </div>
      );
    }

    return (
      <div className="vault-section-layout single-column">
        {activeComposer === 'snippets' ? (
          <section className="vault-composer-panel">
            <div className="pane-grid cols-2">
              <label>
                <span>Nombre</span>
                <input value={snippetDraftName} onChange={(event) => setSnippetDraftName(event.target.value)} placeholder="Restart api" />
              </label>
              <label>
                <span>Descripcion</span>
                <input value={snippetDraftDescription} onChange={(event) => setSnippetDraftDescription(event.target.value)} placeholder="Uso rapido" />
              </label>
              <label className="full-width">
                <span>Comando</span>
                <textarea rows={5} value={snippetDraftCommand} onChange={(event) => setSnippetDraftCommand(event.target.value)} placeholder="docker compose restart api" />
              </label>
            </div>
            <div className="button-row">
              <button type="button" className="secondary" onClick={closeComposer}>
                Cancelar
              </button>
              <button type="button" className="primary" onClick={createSnippetEntry}>
                Guardar Snippet
              </button>
            </div>
          </section>
        ) : null}
        <div className="vault-card-list selectable-list">
          {snippetItems.map((item) => (
            <button key={item.id} type="button" className="vault-host-card" onClick={() => loadSnippetEntry(item)}>
              <span className="vault-host-card-badge"><AppIcon name="snippets" /></span>
              <span className="vault-host-card-copy">
                <strong>{item.name}</strong>
                <span>{item.description || 'sin descripcion'}</span>
                <span>{item.command}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderVaultKnownHostsSection() {
    const isEmpty = filteredKnownHosts.length === 0 && !discoveredHostKey;

    if (isEmpty) {
      return (
        <div className="vault-section-layout single-column">
          <section className="vault-empty-panel">
            <div className="vault-empty-icon"><AppIcon name="known-hosts" /></div>
            <h3>Known hosts will appear here</h3>
            <p>Known hosts are trusted server identities saved for secure future connections.</p>
            <button type="button" className="command-chip primary" onClick={() => void probeHostKey()}>
              Import
            </button>
          </section>
        </div>
      );
    }

    return (
      <div className="vault-section-layout single-column">
        <section className="stack-card">
          <SectionHeading title="Known Hosts" subtitle="Host keys confiables para validar identidad antes de abrir una sesion." />
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => void probeHostKey()}>
              Descubrir Host Key
            </button>
            <button type="button" className="secondary" onClick={trustDiscoveredHostKey}>
              Confiar Host
            </button>
            <button type="button" className="secondary" onClick={applyKnownHostForCurrentTarget}>
              Usar Known Host
            </button>
          </div>
          {discoveredHostKey ? (
            <div className="info-banner">
              <strong>{discoveredHostKey.algorithm}</strong>
              <span>{discoveredHostKey.host}:{discoveredHostKey.port}</span>
              <span>{discoveredHostKey.fingerprintSha256}</span>
            </div>
          ) : null}
          <div className="vault-card-list known-host-card-list">
            {filteredKnownHosts.length > 0 ? (
              filteredKnownHosts.map((entry) => (
                <button
                  key={`${entry.host}:${entry.port}:${entry.fingerprintSha256}`}
                  type="button"
                  className="vault-host-card"
                  onClick={() => {
                    updateField('host', entry.host);
                    updateField('port', String(entry.port));
                    updateField('knownHostFingerprint', entry.fingerprintSha256);
                  }}
                >
                  <span className="vault-host-card-badge"><AppIcon name="known-hosts" /></span>
                  <span className="vault-host-card-copy">
                    <strong>{entry.label || entry.host}</strong>
                    <span>{entry.host}:{entry.port}</span>
                    <span>{entry.fingerprintSha256}</span>
                  </span>
                </button>
              ))
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  function renderVaultLogsSection() {
    return (
      <div className="vault-section-layout single-column">
        <section className="stack-card">
          <SectionHeading title="Logs" subtitle="Historial reciente de conexiones guardadas dentro de la app." />
          <div className="vault-log-table">
            <div className="vault-log-header">
              <strong>Date</strong>
              <strong>User</strong>
              <strong>Host</strong>
              <strong>Saved</strong>
            </div>
            {filteredRecentConnections.length > 0 ? (
              filteredRecentConnections.map((entry) => (
                <button key={entry.id} type="button" className="vault-log-row" onClick={() => loadRecentConnection(entry)}>
                  <span>
                    <strong>{new Date(entry.connectedAt * 1000).toLocaleDateString()}</strong>
                    <small>{new Date(entry.connectedAt * 1000).toLocaleTimeString()}</small>
                  </span>
                  <span>
                    <strong>{entry.username}</strong>
                    <small>{entry.environment || 'default environment'}</small>
                  </span>
                  <span>
                    <strong>{entry.host}</strong>
                    <small>ssh, {entry.username}</small>
                  </span>
                  <span className="vault-log-bookmark">⌑</span>
                </button>
              ))
            ) : (
              <EmptyState text="No hay historial reciente para mostrar en logs." />
            )}
          </div>
        </section>
      </div>
    );
  }

  function renderVaultCommandBar() {
    return (
      <div className="replica-command-bar">
        <div className="replica-command-actions">
          {activeVaultSection === 'hosts' ? (
            <>
              <button type="button" className="command-chip primary" onClick={() => openComposer('hosts')}>
                Create
              </button>
              <button type="button" className="command-chip" onClick={connect}>
                Terminal
              </button>
              <button type="button" className="command-chip" onClick={() => void issueRelayLease()}>
                Serial
              </button>
            </>
          ) : null}
          {activeVaultSection === 'keychain' ? (
            <>
              <button type="button" className="command-chip primary" onClick={() => openComposer('keychain')}>
                Create
              </button>
              <button type="button" className="command-chip" onClick={() => void issueCertificate()}>
                Certificate
              </button>
              <button type="button" className="command-chip" onClick={() => setFeedback('flujo fido2 pendiente')}>
                FIDO2
              </button>
            </>
          ) : null}
          {activeVaultSection === 'port-forwarding' ? (
            <button type="button" className="command-chip primary" onClick={() => openComposer('port-forwarding')}>
              Create
            </button>
          ) : null}
          {activeVaultSection === 'snippets' ? (
            <>
              <button type="button" className="command-chip primary" onClick={() => openComposer('snippets')}>
                Create
              </button>
              <button type="button" className="command-chip" onClick={() => void loadRecentConnections()}>
                Shell History
              </button>
            </>
          ) : null}
          {activeVaultSection === 'known-hosts' ? (
            <button type="button" className="command-chip primary" onClick={() => void probeHostKey()}>
              Import
            </button>
          ) : null}
          {activeVaultSection === 'logs' ? (
            <button type="button" className="command-chip primary" onClick={() => void loadRecentConnections()}>
              Refresh Logs
            </button>
          ) : null}
        </div>
        <div className="replica-command-tools">
          <button type="button" className="command-icon-button" aria-label="Buscar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="11" cy="11" r="6" />
              <path d="m20 20-4.2-4.2" />
            </svg>
          </button>
          <button type="button" className="command-icon-button" aria-label="Grid">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="4" y="4" width="6" height="6" />
              <rect x="14" y="4" width="6" height="6" />
              <rect x="4" y="14" width="6" height="6" />
              <rect x="14" y="14" width="6" height="6" />
            </svg>
          </button>
          <button type="button" className="command-icon-button" aria-label="Panels">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="4" y="5" width="16" height="14" />
              <path d="M12 5v14" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  function renderVaultWorkspace() {
    switch (activeVaultSection) {
      case 'hosts':
        return renderVaultHostsSection();
      case 'keychain':
        return renderVaultKeychainSection();
      case 'port-forwarding':
        return renderVaultPortForwardingSection();
      case 'snippets':
        return renderVaultSnippetsSection();
      case 'known-hosts':
        return renderVaultKnownHostsSection();
      case 'logs':
        return renderVaultLogsSection();
      default:
        return renderVaultHostsSection();
    }
  }

  async function loadRecentConnections() {
    try {
      const response = await invoke<RecentConnectionsResponse>('list_recent_connections_command');
      setRecentConnections(response.entries);
      setRecentHistoryPath(response.historyPath);
    } catch {
      setRecentConnections([]);
    }
  }

  function loadRecentConnection(entry: RecentConnectionEntry) {
    const knownHost = findKnownHost(knownHosts, entry.host, entry.port);
    setForm((current) => ({
      ...current,
      name: entry.profileName,
      host: entry.host,
      port: String(entry.port),
      username: entry.username,
      knownHostFingerprint: knownHost?.fingerprintSha256 ?? current.knownHostFingerprint,
      relayTargetNodeId: entry.relayTargetNodeId ?? '',
      controlPlaneEnvironment: entry.environment ?? current.controlPlaneEnvironment,
    }));
    setFeedback(`conexion reciente cargada: ${entry.profileName}`);
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

  function renderTerminalWorkspace() {
    return (
      <section className="terminal-replica-workspace">
        <div className="terminal-replica-toolbar">
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
          <div className="terminal-replica-actions">
            <button type="button" className="secondary" onClick={() => void probeHostKey()}>
              Host Key
            </button>
            <button type="button" className="secondary" onClick={() => void issueCertificate()}>
              Cert
            </button>
            <button type="button" className="primary" onClick={connect}>
              {activeLaunch && pendingSessionChanges.length > 0 ? 'Reconectar' : 'Conectar'}
            </button>
          </div>
        </div>

        <div className="terminal-replica-meta">
          <div>
            <span>Host Trust</span>
            <strong>{form.knownHostFingerprint.trim() || currentKnownHost?.fingerprintSha256 || 'pending'}</strong>
          </div>
          <div>
            <span>Certificate</span>
            <strong>{issuedCertificate ? issuedCertificate.keyId : form.certificatePem ? 'manual certificate' : 'not issued'}</strong>
          </div>
          <div>
            <span>Relay</span>
            <strong>{issuedRelayLease ? issuedRelayLease.relayAddress : form.relayTargetNodeId || 'direct'}</strong>
          </div>
        </div>

        <div className="terminal-replica-canvas">
          {activeLaunch ? <TerminalView key={activeLaunch.launchId} request={activeLaunch.request} /> : <IdleTerminalCard />}
        </div>
      </section>
    );
  }

  function renderHostsWorkspace() {
    const localBreadcrumbs = buildSftpBreadcrumbs(sftpLocalPath);
    const remoteHostLabel = activeLaunch?.request.profileName || form.name || 'Host';
    const remoteHostSummary = activeLaunch?.request.host || form.host;
    const hasRemoteHost = Boolean(remoteHostSummary);
    const remoteConnectLabel = activeLaunch ? 'Reconnect' : 'Connect';

    return (
      <div className="sftp-browser-layout">
        <section className="sftp-browser-panel">
          <header className="sftp-panel-header">
            <div className="sftp-panel-title">
              <span className="sftp-panel-badge">
                <AppIcon name="sftp" />
              </span>
              <strong>Local</strong>
            </div>
            <div className="sftp-panel-actions">
              <button type="button" className="sftp-toolbar-button" onClick={toggleSftpHiddenEntries}>
                {isSftpShowingHidden ? 'Hide hidden' : 'Show hidden'}
              </button>
              <button type="button" className="sftp-toolbar-button" onClick={refreshSftpLocalDirectory}>
                Refresh
              </button>
            </div>
          </header>

          <div className="sftp-breadcrumb-bar">
            <button type="button" className="sftp-nav-button" onClick={navigateSftpLocalUp} aria-label="Volver a la raiz local">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button type="button" className="sftp-nav-button" onClick={() => navigateSftpLocalPath('C:/')} aria-label="Abrir disco local">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
            <div className="sftp-breadcrumbs">
              {localBreadcrumbs.map((segment) => (
                <button key={segment.path} type="button" className="sftp-breadcrumb-segment" onClick={() => navigateSftpLocalPath(segment.path)}>
                  {segment.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sftp-file-table">
            <div className="sftp-file-header">
              <strong>Name</strong>
              <strong>Date Modified</strong>
              <strong>Size</strong>
              <strong>Kind</strong>
            </div>
            {isSftpLocalLoading ? <div className="sftp-empty-message">Loading local storage...</div> : null}
            {!isSftpLocalLoading && sftpLocalError ? <div className="sftp-empty-message is-error">{sftpLocalError}</div> : null}
            {!isSftpLocalLoading && !sftpLocalError && visibleSftpLocalEntries.length === 0 ? (
              <div className="sftp-empty-message">No entries match the current local filter.</div>
            ) : null}
            {!isSftpLocalLoading && !sftpLocalError
              ? visibleSftpLocalEntries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    className="sftp-file-row"
                    onClick={() => (entry.entryType === 'folder' ? navigateSftpLocalPath(entry.path) : undefined)}
                  >
                    <span className="sftp-file-name">
                      <span className={`sftp-entry-icon is-${entry.entryType}`}>
                        {entry.entryType === 'folder' ? (
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M3.5 6.5h6l2 2H20a1.5 1.5 0 0 1 1.5 1.5v7A2.5 2.5 0 0 1 19 19.5H5A2.5 2.5 0 0 1 2.5 17V8A1.5 1.5 0 0 1 4 6.5Z" />
                          </svg>
                        ) : entry.entryType === 'link' ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M10 14 21 3" />
                            <path d="M15 3h6v6" />
                            <path d="M21 14v4a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h4" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M7 3.5h7l4.5 4.5V20A1.5 1.5 0 0 1 17 21.5H7A2.5 2.5 0 0 1 4.5 19V6A2.5 2.5 0 0 1 7 3.5Z" />
                          </svg>
                        )}
                      </span>
                      <strong>{entry.name}</strong>
                    </span>
                    <span>{formatSftpDate(entry.modifiedAt)}</span>
                    <span>{formatSftpSize(entry.sizeBytes)}</span>
                    <span>{entry.kind}</span>
                  </button>
                ))
              : null}
          </div>
        </section>

        <section className="sftp-browser-panel remote-panel">
          <header className="sftp-panel-header">
            <div className="sftp-panel-title">
              <span className="sftp-panel-badge is-remote">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="5" width="16" height="14" rx="2.5" />
                  <path d="M8 9h8" />
                  <path d="M9 14h6" />
                </svg>
              </span>
              <strong>{hasRemoteHost ? remoteHostLabel : 'Host'}</strong>
            </div>
            <div className="sftp-panel-actions">
              <button type="button" className="sftp-toolbar-button" onClick={connect} disabled={!hasRemoteHost}>
                {remoteConnectLabel}
              </button>
              <button type="button" className="sftp-toolbar-button" onClick={openSftpHostSelector}>
                Change host
              </button>
            </div>
          </header>

          {hasRemoteHost ? (
            <div className="sftp-remote-shell">
              <div className="sftp-breadcrumb-bar remote-breadcrumb-bar">
                <div className="sftp-breadcrumbs">
                  <span className="sftp-breadcrumb-segment">{remoteHostSummary}</span>
                  <span className="sftp-breadcrumb-segment">/</span>
                </div>
              </div>
              <section className="vault-empty-panel sftp-empty-remote">
                <div className="vault-empty-icon">
                  <AppIcon name="sftp" />
                </div>
                <h3>Connect to host</h3>
                <p>Start by connecting to the selected host to manage your files with SFTP.</p>
                <div className="button-row sftp-empty-actions">
                  <button type="button" className="secondary" onClick={connect}>
                    Connect
                  </button>
                  <button type="button" className="command-chip primary" onClick={openSftpHostSelector}>
                    Change host
                  </button>
                </div>
              </section>
            </div>
          ) : (
            <section className="vault-empty-panel sftp-empty-remote">
              <div className="vault-empty-icon">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3.5 6.5h6l2 2H20a1.5 1.5 0 0 1 1.5 1.5v7A2.5 2.5 0 0 1 19 19.5H5A2.5 2.5 0 0 1 2.5 17V8A1.5 1.5 0 0 1 4 6.5Z" />
                </svg>
              </div>
              <h3>Connect to host</h3>
              <p>Start by connecting to a saved host to manage your files with SFTP.</p>
              <button type="button" className="command-chip primary" onClick={openSftpHostSelector}>
                Select host
              </button>
            </section>
          )}
        </section>
      </div>
    );
  }

  function renderRelayWorkspace() {
    return (
      <div className="workspace-grid">
        <section className="stack-card">
          <SectionHeading title="Control Plane" subtitle="Base URL, principals y emision de certificados" />
          <div className="pane-grid cols-2">
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
          <div className="info-grid">
            <TelemetryCard
              label="Environment"
              value={form.controlPlaneEnvironment || 'development'}
              hint={activeControlPlane ? 'configuracion activa para la siguiente emision' : 'sin control-plane configurado'}
            />
            <TelemetryCard
              label="Last Certificate"
              value={issuedCertificate ? issuedCertificate.keyId : 'none'}
              hint={issuedCertificate ? new Date(issuedCertificate.expiresAt * 1000).toLocaleString() : 'sin certificado emitido'}
            />
          </div>
        </section>

        <section className="stack-card">
          <SectionHeading title="Relay CGNAT" subtitle="Leases, target nodes y rutas de acceso indirecto" />
          <div className="pane-grid cols-2">
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
            <label className="full-width">
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
          <div className="info-grid">
            <TelemetryCard
              label="Relay Route"
              value={issuedRelayLease ? issuedRelayLease.relayAddress : form.relayUrl || 'not resolved'}
              hint={issuedRelayLease ? issuedRelayLease.leaseId : 'sin lease vigente'}
            />
            <TelemetryCard
              label="Target Node"
              value={form.relayTargetNodeId || 'direct'}
              hint={issuedRelayLease ? `expira ${new Date(issuedRelayLease.expiresAt * 1000).toLocaleString()}` : 'sin nodo relay seleccionado'}
            />
          </div>
        </section>
      </div>
    );
  }

  function renderCollabWorkspace() {
    return (
      <div className="workspace-grid">
        <section className="stack-card">
          <SectionHeading title="Session Mirror" subtitle="Viewer roles y transcript read-only" />
          <div className="pane-grid cols-2">
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
          ) : (
            <EmptyState text="No hay mirrors visibles todavia para el actor actual." />
          )}
        </section>

        <section className="stack-card">
          <SectionHeading title="Collab Audit" subtitle="Traza operativa separada del terminal activo" />
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => void loadCollabAudit()}>
              Ver Audit
            </button>
          </div>
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
          ) : (
            <EmptyState text="Carga la auditoria colaborativa para inspeccionar eventos recientes." />
          )}
        </section>
      </div>
    );
  }

  function renderActiveWorkspace() {
    switch (activeWorkspace) {
      case 'hosts':
        return renderHostsWorkspace();
      case 'vaults':
        return renderVaultWorkspace();
      case 'relay':
        return renderRelayWorkspace();
      case 'collab':
        return renderCollabWorkspace();
      case 'terminal':
      default:
        return renderTerminalWorkspace();
    }
  }

  return (
    <>
      <input
        ref={credentialFileInputRef}
        type="file"
        accept=".pem,.key,.pub,.txt"
        multiple
        hidden
        onChange={(event) => void importCredentialFiles(event.target.files, event.currentTarget)}
      />

      <main className="shell shell-app native-shell terminal-replica-shell">
        <header
          className={`window-titlebar ${isWindowFocused ? 'is-focused' : 'is-blurred'}`}
          data-tauri-drag-region
          onDoubleClick={handleTitlebarDoubleClick}
        >
          <div className="titlebar-tabs" data-tauri-drag-region>
            <div ref={browserMenuRef} className="titlebar-menu-anchor" data-no-drag="true">
              <button type="button" className="titlebar-hamburger" onClick={toggleBrowserMenu} data-no-drag="true" aria-label="Abrir menu principal" aria-expanded={isBrowserMenuOpen}>
                <span />
                <span />
                <span />
              </button>
              {isBrowserMenuOpen ? (
                <div className="browser-menu-panel" onMouseLeave={() => setActiveBrowserSubmenu(null)}>
                  <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(async () => openVaultWorkspace())}>
                    <span>Vaults</span>
                    <span className="browser-menu-shortcut">Ctrl + 1</span>
                  </button>
                  <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(async () => openSftpWorkspace())}>
                    <span>SFTP</span>
                    <span className="browser-menu-shortcut">Ctrl + 2</span>
                  </button>
                  <button type="button" className="browser-menu-item" onClick={openSettingsPanel}>
                    <span>Settings</span>
                    <span className="browser-menu-shortcut">Ctrl + Coma</span>
                  </button>

                  <div className="browser-menu-separator" />

                  <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(async () => startNewConnection())}>
                    <span>New Local Terminal</span>
                  </button>
                  <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(async () => openSerialWorkspace())}>
                    <span>New Serial Connection</span>
                  </button>

                  <div className="browser-menu-separator" />

                  <div className={`browser-menu-item browser-menu-item-branch ${activeBrowserSubmenu === 'edit' ? 'is-open' : ''}`} onMouseEnter={() => setActiveBrowserSubmenu('edit')}>
                    <button type="button" className="browser-menu-branch-button" onClick={() => setActiveBrowserSubmenu((current) => (current === 'edit' ? null : 'edit'))}>
                      <span>Edit</span>
                      <span className="browser-menu-chevron">›</span>
                    </button>
                    {activeBrowserSubmenu === 'edit' ? (
                      <div className="browser-submenu-panel">
                        <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(async () => handleClearSearch())}>
                          <span>Clear Search</span>
                        </button>
                        <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(async () => handleResetConnectionDraft())}>
                          <span>Reset Draft</span>
                        </button>
                        <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(async () => credentialFileInputRef.current?.click())}>
                          <span>Import Keys</span>
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className={`browser-menu-item browser-menu-item-branch ${activeBrowserSubmenu === 'view' ? 'is-open' : ''}`} onMouseEnter={() => setActiveBrowserSubmenu('view')}>
                    <button type="button" className="browser-menu-branch-button" onClick={() => setActiveBrowserSubmenu((current) => (current === 'view' ? null : 'view'))}>
                      <span>View</span>
                      <span className="browser-menu-chevron">›</span>
                    </button>
                    {activeBrowserSubmenu === 'view' ? (
                      <div className="browser-submenu-panel">
                        <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(async () => startNewConnection())}>
                          <span>Terminal</span>
                        </button>
                        <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(async () => openVaultWorkspace())}>
                          <span>Vaults</span>
                        </button>
                        <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(async () => openSftpWorkspace())}>
                          <span>SFTP</span>
                        </button>
                        <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(async () => openRelayWorkspace())}>
                          <span>Relay</span>
                        </button>
                        <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(async () => openCollabWorkspace())}>
                          <span>Collab</span>
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className={`browser-menu-item browser-menu-item-branch ${activeBrowserSubmenu === 'window' ? 'is-open' : ''}`} onMouseEnter={() => setActiveBrowserSubmenu('window')}>
                    <button type="button" className="browser-menu-branch-button" onClick={() => setActiveBrowserSubmenu((current) => (current === 'window' ? null : 'window'))}>
                      <span>Window</span>
                      <span className="browser-menu-chevron">›</span>
                    </button>
                    {activeBrowserSubmenu === 'window' ? (
                      <div className="browser-submenu-panel">
                        <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(minimizeWindow)}>
                          <span>Minimize</span>
                        </button>
                        <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(toggleWindowMaximize)}>
                          <span>{isWindowMaximized ? 'Restore' : 'Maximize'}</span>
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className={`browser-menu-item browser-menu-item-branch ${activeBrowserSubmenu === 'help' ? 'is-open' : ''}`} onMouseEnter={() => setActiveBrowserSubmenu('help')}>
                    <button type="button" className="browser-menu-branch-button" onClick={() => setActiveBrowserSubmenu((current) => (current === 'help' ? null : 'help'))}>
                      <span>Help</span>
                      <span className="browser-menu-chevron">›</span>
                    </button>
                    {activeBrowserSubmenu === 'help' ? (
                      <div className="browser-submenu-panel">
                        <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(async () => openRelayWorkspace())}>
                          <span>Connection Diagnostics</span>
                        </button>
                        <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(async () => setFeedback('Ozy Terminal listo para vaults, relay y sesiones ssh'))}>
                          <span>About Ozy Terminal</span>
                        </button>
                      </div>
                    ) : null}
                  </div>

                  <div className="browser-menu-separator" />

                  <button type="button" className="browser-menu-item" onClick={() => handleBrowserMenuAction(closeWindow)}>
                    <span>Exit</span>
                  </button>
                </div>
              ) : null}
            </div>
            <div
              ref={vaultMenuRef}
              className={`titlebar-tab-group ${activeWorkspace === 'vaults' ? 'is-active' : ''}`}
              data-no-drag="true"
            >
              <button
                type="button"
                className="titlebar-tab shell-tab-static titlebar-tab-group-main"
                onClick={() => {
                  setActiveWorkspace('vaults');
                  setIsVaultSidebarOpen(true);
                }}
                data-no-drag="true"
              >
                <span className="titlebar-tab-icon"><AppIcon name="vaults" /></span>
                <span className="titlebar-tab-copy single-line-tab-copy">
                  <strong>Vaults</strong>
                </span>
              </button>
              <button
                type="button"
                className="titlebar-tab titlebar-tab-caret titlebar-tab-group-extension"
                onClick={toggleVaultMenu}
                data-no-drag="true"
                aria-label="Abrir opciones de Vaults"
              >
                <span className={`titlebar-tab-caret-icon ${isVaultMenuOpen ? 'is-open' : ''}`}>⌄</span>
              </button>
              {isVaultMenuOpen ? (
                <div className="vault-scope-menu">
                  <button
                    type="button"
                    className={`vault-scope-option ${activeVaultScope === 'personal' ? 'is-active' : ''}`}
                    onClick={() => selectVaultScope('personal')}
                  >
                    <span className="vault-scope-option-leading">
                      <span className="vault-scope-option-icon"><AppIcon name="person" /></span>
                      <strong>Personal</strong>
                    </span>
                    <span className="vault-scope-option-trailing">
                      <span className="vault-scope-option-user">◌</span>
                      {activeVaultScope === 'personal' ? <span className="vault-scope-option-check">✓</span> : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`vault-scope-option ${activeVaultScope === 'team' ? 'is-active' : ''}`}
                    onClick={() => selectVaultScope('team')}
                  >
                    <span className="vault-scope-option-leading">
                      <span className="vault-scope-option-icon"><AppIcon name="team" /></span>
                      <strong>Team</strong>
                    </span>
                    <span className="vault-scope-option-trailing">
                      <span className="vault-scope-option-user">◎</span>
                      {activeVaultScope === 'team' ? <span className="vault-scope-option-check">✓</span> : null}
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className={`titlebar-tab shell-tab-static ${activeWorkspace === 'hosts' ? 'is-active' : ''}`}
              onClick={() => setActiveWorkspace('hosts')}
              data-no-drag="true"
            >
              <span className="titlebar-tab-icon"><AppIcon name="sftp" /></span>
              <span className="titlebar-tab-copy single-line-tab-copy">
                <strong>SFTP</strong>
              </span>
            </button>
            {isTerminalTabOpen ? (
              <div
                className={`titlebar-tab shell-tab-connection ${activeWorkspace === 'terminal' ? 'is-active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setActiveWorkspace('terminal')}
                onKeyDown={handleTerminalTabKeyDown}
                data-no-drag="true"
              >
                <span className="titlebar-tab-indicator titlebar-tab-indicator-warm" aria-hidden="true" />
                <span className="titlebar-tab-copy single-line-tab-copy">
                  <strong>{activeLaunch?.request.profileName || form.name || 'SSH'}</strong>
                </span>
                <button type="button" className="titlebar-tab-close" onClick={closeActiveTerminalTab} aria-label="Cerrar sesion terminal" data-no-drag="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="m7 7 10 10" />
                    <path d="m17 7-10 10" />
                  </svg>
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className="titlebar-tab titlebar-tab-add"
              onClick={startNewConnection}
              data-no-drag="true"
              aria-label="Abrir vista terminal"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
            </button>
          </div>

          <div className="titlebar-search" data-tauri-drag-region>
            <label className="titlebar-searchbox" data-no-drag="true">
              <span className="titlebar-search-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="11" cy="11" r="6" />
                  <path d="m20 20-4.2-4.2" />
                </svg>
              </span>
              <input type="text" value={titlebarSearch} onChange={(event) => setTitlebarSearch(event.target.value)} placeholder="Search" />
              <button
                type="button"
                className="titlebar-search-shortcut"
                onClick={() => setTitlebarSearch('')}
                data-no-drag="true"
                aria-label="Limpiar busqueda"
              >
                {titlebarSearch ? 'clear' : '>/'}
              </button>
            </label>
          </div>

          <div className="titlebar-window-area" data-tauri-drag-region>
            <div className="titlebar-presence titlebar-presence-icons" data-no-drag="true">
              <button type="button" className="titlebar-utility" aria-label="Notificaciones">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-4-5.7V5a2 2 0 1 0-4 0v.3A6 6 0 0 0 6 11v3.2c0 .5-.2 1-.6 1.4L4 17h5" />
                  <path d="M9 17a3 3 0 0 0 6 0" />
                </svg>
              </button>
              <button type="button" className="titlebar-utility" aria-label="Menu rapido">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 6h16" />
                  <path d="M4 12h16" />
                  <path d="M13 18h7" />
                </svg>
              </button>
            </div>

            <div className="window-controls" data-no-drag="true">
              <button type="button" className="window-control" onClick={() => void minimizeWindow()} aria-label="Minimizar ventana">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M6 12h12" />
                </svg>
              </button>
              <button
                type="button"
                className="window-control"
                onClick={() => void toggleWindowMaximize()}
                aria-label={isWindowMaximized ? 'Restaurar ventana' : 'Maximizar ventana'}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  {isWindowMaximized ? (
                    <>
                      <path d="M8 8h9v9" />
                      <path d="M7 16V7h9" />
                    </>
                  ) : (
                    <rect x="6.5" y="6.5" width="11" height="11" rx="0.8" />
                  )}
                </svg>
              </button>
              <button type="button" className="window-control is-close" onClick={() => void closeWindow()} aria-label="Cerrar ventana">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="m7 7 10 10" />
                  <path d="m17 7-10 10" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        <section className={`replica-main-layout ${activeWorkspace === 'vaults' && isVaultSidebarOpen ? 'has-vault-sidebar' : 'is-full-width'}`}>
          {isSettingsPanelOpen ? (
            <div className="settings-overlay" data-no-drag="true" onClick={() => setIsSettingsPanelOpen(false)}>
              <section className="settings-panel" onClick={(event) => event.stopPropagation()}>
                <header className="settings-panel-header">
                  <div>
                    <strong>Settings</strong>
                    <span>Atajos, tema y superficie general del shell.</span>
                  </div>
                  <button type="button" className="settings-close" onClick={() => setIsSettingsPanelOpen(false)}>
                    ×
                  </button>
                </header>

                <div className="settings-grid">
                  <section className="settings-card">
                    <SectionHeading title="Workspaces" subtitle="Saltos rapidos equivalentes al menu de la hamburguesa." />
                    <div className="settings-action-list">
                      <button type="button" className="command-chip primary" onClick={() => openVaultWorkspace()}>
                        Vaults
                      </button>
                      <button type="button" className="command-chip" onClick={() => openSftpWorkspace()}>
                        SFTP
                      </button>
                      <button type="button" className="command-chip" onClick={() => openRelayWorkspace()}>
                        Relay
                      </button>
                      <button type="button" className="command-chip" onClick={() => openCollabWorkspace()}>
                        Collab
                      </button>
                    </div>
                  </section>

                  <section className="settings-card">
                    <SectionHeading title="Appearance" subtitle="Presets visuales listos para expandirse luego a persistencia real." />
                    <div className="settings-theme-list">
                      {themePresets.map((preset) => (
                        <button key={preset.name} type="button" className={`settings-theme-item ${preset.isActive ? 'is-active' : ''}`} onClick={() => setFeedback(`preset ${preset.name} seleccionado`)}>
                          <span className={`settings-theme-swatch ${preset.accentClass}`} />
                          <span className="settings-theme-copy">
                            <strong>{preset.name}</strong>
                            <span>{preset.meta}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="settings-card">
                    <SectionHeading title="Session" subtitle="Estado operativo visible sin salir del shell actual." />
                    <div className="settings-status-stack">
                      <div className="settings-status-row">
                        <span>Workspace</span>
                        <strong>{workspaceMeta[activeWorkspace].label}</strong>
                      </div>
                      <div className="settings-status-row">
                        <span>Vault Scope</span>
                        <strong>{activeVaultScope === 'personal' ? 'Personal' : 'Team'}</strong>
                      </div>
                      <div className="settings-status-row">
                        <span>Session</span>
                        <strong>{statusSummary}</strong>
                      </div>
                    </div>
                  </section>
                </div>
              </section>
            </div>
          ) : null}

          {activeWorkspace === 'vaults' && isVaultSidebarOpen ? (
            <aside className="replica-left-rail">
              <nav className="left-rail-nav">
                {shellNavigation.map((item) => (
                  <button key={item.id} type="button" className={`left-rail-item ${activeVaultSection === item.id ? 'is-active' : ''}`} onClick={() => selectVaultSection(item.id)}>
                    <span className="left-rail-item-icon"><AppIcon name={item.icon} /></span>
                    <strong>{item.label}</strong>
                  </button>
                ))}
              </nav>
            </aside>
          ) : null}

          <section className="replica-stage-shell">
            {activeWorkspace === 'vaults' ? renderVaultCommandBar() : null}

            <div className="replica-workspace-scroll">{renderActiveWorkspace()}</div>
          </section>
        </section>
      </main>
    </>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="section-heading">
      <h3>{title}</h3>
      <p>{subtitle}</p>
    </div>
  );
}

function AppIcon({ name }: { name: AppIconName }) {
  switch (name) {
    case 'vaults':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5Z" />
          <path d="M4 7.5 12 11l8-3.5" />
          <path d="M12 11v9" />
        </svg>
      );
    case 'sftp':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="6" width="16" height="12" rx="2.5" />
          <path d="M8 10h8" />
          <path d="m10 13-2 2 2 2" />
          <path d="m14 13 2 2-2 2" />
        </svg>
      );
    case 'hosts':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="5" width="7" height="6" rx="1.5" />
          <rect x="13" y="5" width="7" height="6" rx="1.5" />
          <rect x="4" y="13" width="7" height="6" rx="1.5" />
          <rect x="13" y="13" width="7" height="6" rx="1.5" />
        </svg>
      );
    case 'keychain':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="8.5" r="3.5" />
          <path d="M12.5 8.5H20" />
          <path d="M17 8.5V12" />
          <path d="M14 12h6" />
          <path d="M8.8 12v7" />
        </svg>
      );
    case 'port-forwarding':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 7h10" />
          <path d="m12 4 3 3-3 3" />
          <path d="M19 17H9" />
          <path d="m12 14-3 3 3 3" />
        </svg>
      );
    case 'snippets':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 8-4 4 4 4" />
          <path d="m15 8 4 4-4 4" />
          <path d="M13 6 11 18" />
        </svg>
      );
    case 'known-hosts':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3.8 18.5 6v5.2c0 4.3-2.6 7.5-6.5 9-3.9-1.5-6.5-4.7-6.5-9V6Z" />
          <path d="m9.5 11.8 1.7 1.7 3.4-3.7" />
        </svg>
      );
    case 'logs':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 4.5h10" />
          <path d="M12 4.5v4" />
          <circle cx="12" cy="14" r="6.5" />
          <path d="M12 11v3.5l2.5 1.5" />
        </svg>
      );
    case 'person':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5.5 18.5c1.7-3 4.1-4.5 6.5-4.5s4.8 1.5 6.5 4.5" />
        </svg>
      );
    case 'team':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="9" r="3" />
          <circle cx="16.5" cy="10" r="2.5" />
          <path d="M4.5 18c1.4-2.6 3.4-4 5.6-4 2.1 0 4.2 1.4 5.6 4" />
          <path d="M14.5 17.5c.8-1.8 2.1-2.9 4-3.4" />
        </svg>
      );
    default:
      return null;
  }
}

function EmptyState({ text }: { text: string }) {
  return <p className="empty-state">{text}</p>;
}

function TelemetryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="telemetry-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
    </div>
  );
}

function CredentialImportCard({
  title,
  report,
}: {
  title: string;
  report: InspectImportedCredentialResponse;
}) {
  return (
    <section className="credential-card">
      <h4>{title}</h4>
      <p>{report.summary}</p>
      {report.filename ? <p className="hint mono">{report.filename}</p> : null}
      {report.algorithm ? <p className="hint">Algoritmo: {report.algorithm}</p> : null}
      {report.fingerprintSha256 ? <p className="hint mono">{report.fingerprintSha256}</p> : null}
      {report.keyId ? <p className="hint">Key ID: {report.keyId}</p> : null}
      {report.principals.length > 0 ? <p className="hint">Principals: {report.principals.join(', ')}</p> : null}
      {report.validBefore ? (
        <p className="hint">Valido hasta: {new Date(report.validBefore * 1000).toLocaleString()}</p>
      ) : null}
      {report.requiresPassphrase ? (
        <p className="hint">Define la passphrase en el formulario para validar y usar esta clave.</p>
      ) : null}
    </section>
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

function buildSessionRequest(
  form: FormState,
  relayHint?: RelayHint,
  controlPlane?: ControlPlaneConfig,
): SshSessionRequest {
  return {
    profileName: form.name || `${form.username}@${form.host}`,
    host: form.host,
    port: Number(form.port || 22),
    username: form.username,
    privateKeyPem: form.privateKeyPem,
    privateKeyPassphrase: form.privateKeyPassphrase || undefined,
    certificatePem: form.certificatePem || undefined,
    knownHostFingerprint: form.knownHostFingerprint || undefined,
    cols: 120,
    rows: 34,
    relayHint,
    controlPlane,
    mirrorOwnerId: form.mirrorOwnerId.trim() || undefined,
  };
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

function upsertKnownHost(entries: KnownHostEntry[], next: KnownHostEntry) {
  const matchIndex = entries.findIndex((entry) => entry.host === next.host && entry.port === next.port);
  if (matchIndex === -1) {
    return [next, ...entries];
  }

  return entries.map((entry, index) => (index === matchIndex ? next : entry));
}

function findKnownHost(entries: KnownHostEntry[], host: string, port: number) {
  return entries.find((entry) => entry.host === host.trim() && entry.port === port);
}

function structurallyEquivalentSessionRequest(a: SshSessionRequest, b: SshSessionRequest) {
  return (
    a.host === b.host &&
    a.port === b.port &&
    a.username === b.username &&
    a.privateKeyPem === b.privateKeyPem &&
    a.privateKeyPassphrase === b.privateKeyPassphrase &&
    a.certificatePem === b.certificatePem &&
    a.knownHostFingerprint === b.knownHostFingerprint &&
    relayHintEquals(a.relayHint, b.relayHint) &&
    controlPlaneEquals(a.controlPlane, b.controlPlane)
  );
}

function describeStructuralSessionChanges(active: SshSessionRequest, draft: SshSessionRequest) {
  const changes: string[] = [];

  if (active.host !== draft.host || active.port !== draft.port) {
    changes.push('destino');
  }
  if (active.username !== draft.username) {
    changes.push('usuario');
  }
  if (active.privateKeyPem !== draft.privateKeyPem || active.privateKeyPassphrase !== draft.privateKeyPassphrase) {
    changes.push('clave');
  }
  if (active.certificatePem !== draft.certificatePem) {
    changes.push('certificado');
  }
  if (active.knownHostFingerprint !== draft.knownHostFingerprint) {
    changes.push('host key');
  }
  if (!relayHintEquals(active.relayHint, draft.relayHint)) {
    changes.push('relay');
  }
  if (!controlPlaneEquals(active.controlPlane, draft.controlPlane)) {
    changes.push('control-plane');
  }

  return changes;
}

function relayHintEquals(a?: RelayHint, b?: RelayHint) {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  return a.relayUrl === b.relayUrl && a.token === b.token && a.targetNodeId === b.targetNodeId;
}

function controlPlaneEquals(a?: ControlPlaneConfig, b?: ControlPlaneConfig) {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }

  return (
    a.baseUrl === b.baseUrl &&
    a.accessToken === b.accessToken &&
    a.environment === b.environment &&
    a.ttlSeconds === b.ttlSeconds &&
    a.renewBeforeSeconds === b.renewBeforeSeconds &&
    a.principals.join(',') === b.principals.join(',')
  );
}

function labelForTerminalError(kind: TerminalErrorKind) {
  switch (kind) {
    case 'configuration':
      return 'Configuracion';
    case 'connection':
      return 'Conexion';
    case 'host_key':
      return 'Host Key';
    case 'authentication':
      return 'Auth';
    case 'control_plane':
      return 'Control Plane';
    case 'relay':
      return 'Relay';
    case 'certificate':
      return 'Certificado';
    case 'shell':
      return 'Shell';
    default:
      return 'No clasificado';
  }
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
