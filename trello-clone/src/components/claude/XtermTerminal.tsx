import React, { useEffect, useImperativeHandle, useRef, forwardRef } from 'react';
import { Terminal, ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

// Theme mirrors claude-code-runner/public/app.js so the two surfaces feel
// identical when watching the same task.
const CLAUDE_RUNNER_THEME: ITheme = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#638cff',
  cursorAccent: '#0d1117',
  selectionBackground: 'rgba(99, 140, 255, 0.3)',
  black: '#0d1117',
  red: '#f85149',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#76e3ea',
  white: '#e6edf3',
  brightBlack: '#484f58',
  brightRed: '#ff7b72',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#a5d6ff',
  brightWhite: '#f0f6fc',
};

export interface XtermTerminalHandle {
  write(data: string): void;
  clear(): void;
  writeln(line: string): void;
  focus(): void;
  fit(): void;
  getSize(): { cols: number; rows: number };
}

interface XtermTerminalProps {
  onData?: (data: string) => void;
  onResize?: (cols: number, rows: number) => void;
  // Initial buffer replayed on mount (e.g. task.output when a task is selected).
  initialOutput?: string;
  // When this key changes, the terminal is cleared and initialOutput is replayed.
  // Use it to signal "new task selected" without remounting the component.
  sessionKey?: string | null;
  className?: string;
  readOnly?: boolean;
}

const XtermTerminal = forwardRef<XtermTerminalHandle, XtermTerminalProps>(
  ({ onData, onResize, initialOutput, sessionKey, className, readOnly }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const dataHandlerRef = useRef(onData);
    const resizeHandlerRef = useRef(onResize);
    const readOnlyRef = useRef(readOnly);
    const lastSessionKeyRef = useRef<string | null | undefined>(sessionKey);

    // Keep latest handler refs without re-mounting the terminal
    useEffect(() => { dataHandlerRef.current = onData; }, [onData]);
    useEffect(() => { resizeHandlerRef.current = onResize; }, [onResize]);
    useEffect(() => { readOnlyRef.current = readOnly; }, [readOnly]);

    // Mount once
    useEffect(() => {
      if (!containerRef.current) return;

      const isMobile = window.innerWidth <= 768;
      const term = new Terminal({
        theme: CLAUDE_RUNNER_THEME,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Menlo, Monaco, monospace",
        fontSize: isMobile ? 11 : 13,
        lineHeight: isMobile ? 1.2 : 1.3,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 10000,
        convertEol: true,
        allowTransparency: false,
      });

      const fit = new FitAddon();
      const links = new WebLinksAddon();
      term.loadAddon(fit);
      term.loadAddon(links);

      term.open(containerRef.current);

      // Forward keystrokes up
      term.onData((data) => {
        if (readOnlyRef.current) return;
        dataHandlerRef.current?.(data);
      });

      // Forward resize up so server PTY can match
      term.onResize(({ cols, rows }) => {
        resizeHandlerRef.current?.(cols, rows);
      });

      // Initial fit after paint
      requestAnimationFrame(() => {
        try { fit.fit(); } catch { /* ignore */ }
      });

      termRef.current = term;
      fitRef.current = fit;

      // Replay initial output
      if (initialOutput) term.write(initialOutput);

      // Auto-fit on container resize
      const ro = new ResizeObserver(() => {
        try { fit.fit(); } catch { /* ignore */ }
      });
      ro.observe(containerRef.current);

      const onWinResize = () => {
        try { fit.fit(); } catch { /* ignore */ }
      };
      window.addEventListener('resize', onWinResize);

      return () => {
        window.removeEventListener('resize', onWinResize);
        ro.disconnect();
        try { term.dispose(); } catch { /* ignore */ }
        termRef.current = null;
        fitRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // When sessionKey changes, clear + replay new initialOutput
    useEffect(() => {
      if (lastSessionKeyRef.current === sessionKey) return;
      lastSessionKeyRef.current = sessionKey;
      const term = termRef.current;
      if (!term) return;
      term.clear();
      term.reset();
      if (initialOutput) term.write(initialOutput);
      try { fitRef.current?.fit(); } catch { /* ignore */ }
    }, [sessionKey, initialOutput]);

    useImperativeHandle(ref, () => ({
      write: (data: string) => { termRef.current?.write(data); },
      writeln: (line: string) => { termRef.current?.writeln(line); },
      clear: () => { termRef.current?.clear(); termRef.current?.reset(); },
      focus: () => { termRef.current?.focus(); },
      fit: () => { try { fitRef.current?.fit(); } catch { /* ignore */ } },
      getSize: () => ({ cols: termRef.current?.cols ?? 80, rows: termRef.current?.rows ?? 24 }),
    }));

    return <div ref={containerRef} className={className} />;
  }
);

XtermTerminal.displayName = 'XtermTerminal';

export default XtermTerminal;
