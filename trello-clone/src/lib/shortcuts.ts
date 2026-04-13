import { Board, Shortcut } from '../types';

export interface EffectiveShortcut extends Shortcut {
  source: 'global' | 'board';
}

// Union of global and board-level shortcuts. Board-level entries come after
// globals so if two shortcuts share an id the board one wins (de-dup).
export function getEffectiveShortcuts(
  board: Board | undefined,
  globalShortcuts: Shortcut[],
): EffectiveShortcut[] {
  const out = new Map<string, EffectiveShortcut>();
  for (const g of globalShortcuts) out.set(g.id, { ...g, source: 'global' });
  const boardShortcuts = board?.shortcuts ?? [];
  for (const b of boardShortcuts) out.set(b.id, { ...b, source: 'board' });
  return Array.from(out.values());
}

export function newShortcut(): Shortcut {
  return {
    id: `sc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    prompt: '',
    mode: 'one-time',
  };
}
