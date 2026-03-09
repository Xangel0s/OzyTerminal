import { useSyncExternalStore } from 'react';
import { getSessionSnapshot, subscribeSessionStore } from '../store/sessionStore';

export function useTerminalSession() {
  return useSyncExternalStore(subscribeSessionStore, getSessionSnapshot, getSessionSnapshot);
}
