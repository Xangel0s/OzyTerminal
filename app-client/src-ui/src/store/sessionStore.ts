type SessionSnapshot = {
  sessionId: string | null;
  status: 'idle' | 'connecting' | 'connected' | 'closed' | 'error';
  message: string;
};

let snapshot: SessionSnapshot = {
  sessionId: null,
  status: 'idle',
  message: 'ready',
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
