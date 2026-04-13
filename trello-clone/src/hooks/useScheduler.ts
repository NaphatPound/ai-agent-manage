import { useEffect } from 'react';
import { useBoardStore } from '../stores/boardStore';
import { useSettingsStore } from '../stores/settingsStore';
import { createRunnerTask } from '../services/claudeRunner';

const SCHEDULER_INTERVAL = 10000; // check every 10 seconds

function isScheduledList(title: string): boolean {
  return title.toLowerCase().trim() === 'scheduled';
}

function isInProgressList(title: string): boolean {
  const t = title.toLowerCase().trim();
  return t.includes('in progress') || t === 'inprogress' || t === 'in-progress';
}

function isTodoList(title: string): boolean {
  const t = title.toLowerCase().trim();
  return t.includes('to do') || t === 'todo' || t === 'backlog';
}

function buildPromptFromCard(card: { title: string; description?: string; checklists: { title: string; items: { text: string; isChecked: boolean }[] }[] }): string {
  const lines: string[] = [];
  lines.push(`Please implement the following task.`);
  lines.push('', `# Task: ${card.title}`);
  if (card.description) lines.push('', '## Description', card.description);
  if (card.checklists.length > 0) {
    lines.push('', '## Subtasks to complete');
    for (const cl of card.checklists) {
      if (card.checklists.length > 1) lines.push(`\n### ${cl.title}`);
      for (const item of cl.items) {
        lines.push(`- ${item.isChecked ? '[x]' : '[ ]'} ${item.text}`);
      }
    }
  }
  if (!card.description && card.checklists.length === 0) {
    lines.push('', 'Implement this task based on the title. Analyze the codebase, determine what changes are needed, and make them.');
  }
  return lines.join('\n');
}

// Track processed scheduled cards to avoid double-triggering
const processedSchedules = new Set<string>();

export function useScheduler(boardId: string) {
  useEffect(() => {
    let mounted = true;

    const check = async () => {
      if (!mounted) return;

      const now = new Date();
      const state = useBoardStore.getState();
      const board = state.boards[boardId];
      if (!board) return;

      const allLists = board.listIds.map(id => state.lists[id]).filter(Boolean);
      const scheduledList = allLists.find(l => isScheduledList(l.title));
      if (!scheduledList) return;

      // Find cards in Scheduled list that are due
      const freshCards = useBoardStore.getState().cards;
      const dueCards = scheduledList.cardIds
        .map(id => freshCards[id])
        .filter(c =>
          c &&
          c.scheduledAt &&
          !c.claudeTaskId &&
          !c.isArchived &&
          !processedSchedules.has(c.id) &&
          new Date(c.scheduledAt) <= now
        );

      if (dueCards.length === 0) return;

      // Check if there's already a running task in In Progress
      const inProgressList = allLists.find(l => isInProgressList(l.title));
      const todoList = allLists.find(l => isTodoList(l.title));

      if (inProgressList) {
        const freshLists = useBoardStore.getState().lists;
        const freshIPList = freshLists[inProgressList.id];
        if (freshIPList) {
          const hasRunning = freshIPList.cardIds.some(cid => {
            const c = useBoardStore.getState().cards[cid];
            return c && (c.claudeTaskStatus === 'running' || c.claudeTaskStatus === 'queued');
          });
          if (hasRunning) {
            // Move due cards to To Do instead (they'll be picked up by auto-promote)
            if (todoList) {
              for (const card of dueCards) {
                processedSchedules.add(card.id);
                const { moveCard, addComment, updateCard } = useBoardStore.getState();
                const freshTodoList = useBoardStore.getState().lists[todoList.id];
                if (freshTodoList) {
                  moveCard(card.id, scheduledList.id, todoList.id, 0); // prepend at top
                  updateCard(card.id, { scheduledAt: undefined });
                  addComment(card.id, `⏰ Schedule triggered — moved to "${todoList.title}" (another task is running).`);
                  console.log(`[Scheduler] Moved "${card.title}" to To Do (In Progress busy)`);
                }
              }
            }
            return;
          }
        }
      }

      // Process the first due card — move to In Progress and start Claude task
      const card = dueCards[0];
      processedSchedules.add(card.id);

      const { moveCard, addComment, updateCard } = useBoardStore.getState();

      if (inProgressList) {
        const freshIPList = useBoardStore.getState().lists[inProgressList.id];
        if (freshIPList) {
          moveCard(card.id, scheduledList.id, inProgressList.id, freshIPList.cardIds.length);
          updateCard(card.id, { scheduledAt: undefined });
          addComment(card.id, `⏰ Schedule triggered — moved to "${inProgressList.title}" and starting Claude Code task.`);
          console.log(`[Scheduler] Triggered "${card.title}" → In Progress`);

          // Start Claude Code task
          const prompt = buildPromptFromCard(card);
          const { workingDir, selectedModel } = useSettingsStore.getState();
          try {
            updateCard(card.id, { claudeTaskStatus: 'queued' });
            const task = await createRunnerTask(prompt, workingDir || undefined, undefined, selectedModel || undefined, boardId);
            updateCard(card.id, { claudeTaskId: task.id, claudeTaskStatus: task.status });
            addComment(card.id, `🤖 Claude Code task started (ID: ${task.id}).`);
          } catch (e) {
            console.error('[Scheduler] Failed to create task:', e);
            updateCard(card.id, { claudeTaskStatus: undefined });
            addComment(card.id, `❌ Failed to start Claude Code task: ${String(e)}`);
          }
        }
      }

      // Move remaining due cards to To Do
      if (todoList && dueCards.length > 1) {
        for (let i = 1; i < dueCards.length; i++) {
          const c = dueCards[i];
          processedSchedules.add(c.id);
          const freshTodoList = useBoardStore.getState().lists[todoList.id];
          if (freshTodoList) {
            moveCard(c.id, scheduledList.id, todoList.id, 0);
            updateCard(c.id, { scheduledAt: undefined });
            addComment(c.id, `⏰ Schedule triggered — queued in "${todoList.title}".`);
            console.log(`[Scheduler] Queued "${c.title}" in To Do`);
          }
        }
      }
    };

    const interval = setInterval(check, SCHEDULER_INTERVAL);
    check(); // run immediately

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [boardId]);
}
