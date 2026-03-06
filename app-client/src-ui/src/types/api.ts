export type RelayHint = {
  relayUrl: string;
  token: string;
  targetNodeId: string;
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
};

export type LocalVaultResponse = {
  entries: VaultEntry[];
  updatedAt: number;
  vaultPath: string;
};

export type TerminalEvent =
  | { type: 'connected'; session_id: string }
  | { type: 'stdout'; chunk_b64: string }
  | { type: 'closed'; reason: string }
  | { type: 'error'; message: string };
