import { Board, TaskTemplate } from '../types';

export interface EffectiveTaskTemplate extends TaskTemplate {
  source: 'global' | 'board';
}

// Union of global and board-level templates, de-duped by id with board
// entries winning (same pattern as getEffectiveShortcuts).
export function getEffectiveTaskTemplates(
  board: Board | undefined,
  globalTemplates: TaskTemplate[],
): EffectiveTaskTemplate[] {
  const out = new Map<string, EffectiveTaskTemplate>();
  for (const g of globalTemplates) out.set(g.id, { ...g, source: 'global' });
  const boardTemplates = board?.taskTemplates ?? [];
  for (const b of boardTemplates) out.set(b.id, { ...b, source: 'board' });
  return Array.from(out.values());
}

export function newTaskTemplate(): TaskTemplate {
  return {
    id: `tt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    cardTitle: '',
    description: '',
    checklist: [],
  };
}
