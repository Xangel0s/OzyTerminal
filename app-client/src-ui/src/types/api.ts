export type RelayHint = {
  relayUrl: string;
  token: string;
  targetNodeId: string;
};

export type ControlPlaneConfig = {
  baseUrl: string;
  accessToken?: string;
  environment?: string;
  principals: string[];
  ttlSeconds?: number;
  renewBeforeSeconds?: number;
};

export type SshSessionRequest = {
  host: string;
  port: number;
  username: string;
  privateKeyPem: string;
  privateKeyPassphrase?: string;
  certificatePem?: string;
  knownHostFingerprint?: string;
  cols: number;
  rows: number;
  relayHint?: RelayHint;
  controlPlane?: ControlPlaneConfig;
  mirrorOwnerId?: string;
};

export type VaultEntry = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  privateKeyPem: string;
  privateKeyPassphrase?: string;
  certificatePem?: string;
  knownHostFingerprint?: string;
  relayHint?: RelayHint;
  controlPlane?: ControlPlaneConfig;
};

export type LocalVaultResponse = {
  entries: VaultEntry[];
  updatedAt: number;
  vaultPath: string;
};

export type ResolvedSshCertificate = {
  certificateId?: string;
  serial?: number;
  issuedAt: number;
  expiresAt: number;
  caKeyId?: string;
  caPublicKeyOpenssh?: string;
  caFingerprintSha256?: string;
  keyId: string;
  certificatePem: string;
  certificateOpenssh: string;
  principals: string[];
  source: 'existing' | 'control_plane';
};

export type ResolvedRelayLease = {
  leaseId: string;
  token: string;
  relayAddress: string;
  targetNodeId: string;
  requestedPort: number;
  purpose: string;
  issuedAt: number;
  expiresAt: number;
};

export type SharedServerConfig = {
  host: string;
  port: number;
  username: string;
  knownHostFingerprint?: string;
  relayTargetNodeId?: string;
  environment?: string;
};

export type PermissionSubject = {
  type: string;
  id: string;
};

export type PermissionRule = {
  subject: PermissionSubject;
  effect: 'allow' | 'deny';
  actions: string[];
};

export type VaultNode = {
  id: string;
  kind: 'folder' | 'server';
  name: string;
  inheritPermissions: boolean;
  permissions: PermissionRule[];
  children: VaultNode[];
  server?: SharedServerConfig;
};

export type SharedVault = {
  vaultId: string;
  name: string;
  version: number;
  updatedAt: number;
  root: VaultNode;
};

export type SharedVaultResponse = {
  vault: SharedVault;
  vaultPath: string;
};

export type SharedVaultServerView = {
  nodeId: string;
  name: string;
  path: string[];
  host: string;
  port: number;
  username: string;
  knownHostFingerprint?: string;
  relayTargetNodeId?: string;
  environment?: string;
  effectiveActions: string[];
};

export type SharedVaultEntriesResponse = {
  vaultId: string;
  vaultName: string;
  version: number;
  actorIds: string[];
  entries: SharedVaultServerView[];
};

export type MirrorRole = 'owner' | 'editor' | 'viewer';

export type MirrorParticipant = {
  actorId: string;
  sessionId: string;
  role: MirrorRole;
  joinedAt: number;
};

export type SessionMirrorSummary = {
  sessionId: string;
  ownerActorId: string;
  targetLabel: string;
  status: string;
  participantCount: number;
  lastEventAt: number;
};

export type SessionMirrorSnapshot = {
  sessionId: string;
  ownerActorId: string;
  targetLabel: string;
  status: string;
  startedAt: number;
  lastEventAt: number;
  participants: MirrorParticipant[];
  transcript: string;
};

export type TerminalEvent =
  | { type: 'connected'; session_id: string }
  | { type: 'stdout'; chunk_b64: string }
  | { type: 'closed'; reason: string }
  | { type: 'error'; message: string };
