import type { TerminalErrorPayload } from '../types/api';

type SessionSnapshot = {
  sessionId: string | null;
  status: 'idle' | 'connecting' | 'authenticating' | 'connected' | 'closed' | 'error';
  message: string;
  error: TerminalErrorPayload | null;
};

let snapshot: SessionSnapshot = {
  sessionId: null,
  status: 'idle',
  message: 'ready',
  error: null,
};

const listeners = new Set<() => void>();

export function getSessionSnapshot(): SessionSnapshot {
  return snapshot;
}

export function setSessionSnapshot(next: Partial<SessionSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

export function subscribeSessionStore(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
