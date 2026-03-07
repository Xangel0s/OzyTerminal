import { useEffect, useRef } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { setSessionSnapshot } from '../store/sessionStore';
import type { SshSessionRequest, TerminalEvent } from '../types/api';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(input: Uint8Array): string {
  let binary = '';
  input.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return window.btoa(binary);
}

function base64ToText(input: string): string {
  const raw = window.atob(input);
  const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
  return decoder.decode(bytes);
}

export function TerminalView({ request }: { request: SshSessionRequest }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    sessionIdRef.current = null;
    setSessionSnapshot({ sessionId: null, status: 'connecting', message: 'opening ssh session' });

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'Iosevka Term, Consolas, monospace',
      fontSize: 13,
      scrollback: 10000,
      theme: {
        background: '#02080d',
        foreground: '#d7f3f3',
        cursor: '#8ef0c9',
        black: '#09131a',
        brightBlack: '#1b2c36',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;

    const eventChannel = new Channel<TerminalEvent>();
    eventChannel.onmessage = (event) => {
      switch (event.type) {
        case 'connected':
          sessionIdRef.current = event.session_id;
          setSessionSnapshot({ sessionId: event.session_id, status: 'connected', message: 'connected' });
          terminal.writeln('[connected] ssh session established');
          break;
        case 'stdout':
          terminal.write(base64ToText(event.chunk_b64));
          break;
        case 'closed':
          setSessionSnapshot({ status: 'closed', message: event.reason });
          terminal.writeln(`\r\n[closed] ${event.reason}`);
          break;
        case 'error':
          setSessionSnapshot({ status: 'error', message: event.message });
          terminal.writeln(`\r\n[error] ${event.message}`);
          break;
      }
    };

    void invoke<string>('open_session', {
      request: {
        ...request,
        cols: terminal.cols,
        rows: terminal.rows,
      },
      events: eventChannel,
    })
      .then((sessionId) => {
        sessionIdRef.current = sessionId;
      })
      .catch((error) => {
        const message = String(error);
        setSessionSnapshot({ status: 'error', message });
        terminal.writeln(`\r\n[error] ${message}`);
      });

    const dataDisposable = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        return;
      }

      void invoke('send_input', {
        sessionId,
        dataB64: bytesToBase64(encoder.encode(data)),
      });
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        return;
      }

      void invoke('resize_session', {
        sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      dataDisposable.dispose();
      terminal.dispose();

      const sessionId = sessionIdRef.current;
      if (sessionId) {
        void invoke('close_session', { sessionId });
      }

      setSessionSnapshot({ status: 'closed', message: 'disposed' });
    };
  }, [request]);

  return (
    <div className="terminal-shell">
      <div className="terminal-status">
        <span>
          Session <strong>interactive</strong>
        </span>
        <span>Rust channel bridge</span>
      </div>
      <div ref={containerRef} className="terminal-mount" />
    </div>
  );
}
