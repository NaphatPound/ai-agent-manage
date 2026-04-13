import { useEffect } from 'react';
import { useBoardStore } from '../stores/boardStore';
import { useSettingsStore } from '../stores/settingsStore';
import { getRunnerTaskStatus, createRunnerTask } from '../services/claudeRunner';

const POLL_INTERVAL = 5000;

function isInProgressList(title: string): boolean {
  const t = title.toLowerCase().trim();
  return t.includes('in progress') || t === 'inprogress' || t === 'in-progress';
}

function isDoneList(title: string): boolean {
  return title.toLowerCase().trim().includes('done');
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

async function promoteNextCard(boardId: string, completedCard: { taskGroup?: string; boardId: string }) {
  console.log('[Auto-Promote] Starting promotion check for board:', boardId);
  console.log('[Auto-Promote] Completed card taskGroup:', completedCard.taskGroup || '(none)');

  // Always read fresh state
  const state = useBoardStore.getState();
  const board = state.boards[boardId];
  if (!board) {
    console.log('[Auto-Promote] Board not found');
    return;
  }

  // Find lists
  const allLists = board.listIds.map(id => state.lists[id]).filter(Boolean);
  const inProgressList = allLists.find(l => isInProgressList(l.title));
  const todoList = allLists.find(l => isTodoList(l.title));

  console.log('[Auto-Promote] In Progress list:', inProgressList?.title || 'NOT FOUND');
  console.log('[Auto-Promote] To Do list:', todoList?.title || 'NOT FOUND');

  if (!inProgressList || !todoList) {
    console.log('[Auto-Promote] Missing In Progress or To Do list, aborting');
    return;
  }

  // Get fresh list data
  const freshTodoList = useBoardStore.getState().lists[todoList.id];
  if (!freshTodoList || freshTodoList.cardIds.length === 0) {
    console.log('[Auto-Promote] To Do list empty, nothing to promote');
    return;
  }

  console.log('[Auto-Promote] To Do has', freshTodoList.cardIds.length, 'cards');

  // Find next card to promote:
  // 1. If completed card has a taskGroup, find next in same group
  // 2. Otherwise, find any card in To Do without a running task, sorted by taskOrder then position
  const freshCards = useBoardStore.getState().cards;
  let candidates = freshTodoList.cardIds
    .map(id => freshCards[id])
    .filter(c => c && !c.claudeTaskId && !c.isArchived);

  console.log('[Auto-Promote] Candidates in To Do (no task yet):', candidates.length);
  candidates.forEach(c => console.log(`  - "${c.title}" group=${c.taskGroup || 'none'} order=${c.taskOrder ?? 'none'}`));

  if (completedCard.taskGroup) {
    // Filter to same group first
    const sameGroup = candidates.filter(c => c.taskGroup === completedCard.taskGroup);
    if (sameGroup.length > 0) {
      candidates = sameGroup;
      console.log('[Auto-Promote] Filtered to same group "' + completedCard.taskGroup + '":', candidates.length);
    } else {
      // No more in this group — pick from any group
      console.log('[Auto-Promote] No more cards in group "' + completedCard.taskGroup + '", checking other cards');
    }
  }

  if (candidates.length === 0) {
    console.log('[Auto-Promote] No candidates to promote');
    return;
  }

  // Sort by taskOrder (lower first), then by position
  candidates.sort((a, b) => {
    const orderA = a.taskOrder ?? 999;
    const orderB = b.taskOrder ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.position - b.position;
  });

  // Check there's no running/queued task already in In Progress
  const freshIPList = useBoardStore.getState().lists[inProgressList.id];
  if (freshIPList) {
    const hasRunning = freshIPList.cardIds.some(cid => {
      const c = useBoardStore.getState().cards[cid];
      return c && (c.claudeTaskStatus === 'running' || c.claudeTaskStatus === 'queued');
    });
    if (hasRunning) {
      console.log('[Auto-Promote] Already a running task in In Progress, skipping');
      return;
    }
  }

  const nextCard = candidates[0];
  console.log(`[Auto-Promote] >>> Promoting "${nextCard.title}" (group: ${nextCard.taskGroup || 'none'}, order: ${nextCard.taskOrder ?? 'none'})`);

  // Move to In Progress
  const { moveCard, addComment, updateCard } = useBoardStore.getState();
  const freshIPForMove = useBoardStore.getState().lists[inProgressList.id];
  if (!freshIPForMove) return;

  moveCard(nextCard.id, freshTodoList.id, inProgressList.id, freshIPForMove.cardIds.length);
  addComment(nextCard.id, `⏭️ Auto-promoted — previous task completed. Starting next in queue.`);

  // Create Claude Code task
  const cardAfterMove = useBoardStore.getState().cards[nextCard.id];
  if (!cardAfterMove) return;
  const prompt = buildPromptFromCard(cardAfterMove);

  try {
    updateCard(nextCard.id, { claudeTaskStatus: 'queued' });
    const { workingDir, selectedModel } = useSettingsStore.getState();
    const task = await createRunnerTask(prompt, workingDir || undefined, undefined, selectedModel || undefined, boardId);
    console.log(`[Auto-Promote] Claude task created: ${task.id}, status: ${task.status}`);
    updateCard(nextCard.id, { claudeTaskId: task.id, claudeTaskStatus: task.status });
    addComment(nextCard.id, `🤖 Claude Code task started (ID: ${task.id}).`);
  } catch (e) {
    console.error('[Auto-Promote] Failed to create task:', e);
    updateCard(nextCard.id, { claudeTaskStatus: undefined });
    addComment(nextCard.id, `❌ Failed to auto-start Claude Code task: ${String(e)}`);
  }
}

// Track which tasks we've already processed to avoid double-processing
const processedTasks = new Set<string>();

export function useTaskPoller(boardId: string) {
  useEffect(() => {
    let mounted = true;

    const poll = async () => {
      if (!mounted) return;

      const { cards, boards } = useBoardStore.getState();
      const board = boards[boardId];
      if (!board) return;

      const runningCards = Object.values(cards).filter(
        card =>
          card.boardId === boardId &&
          card.claudeTaskId &&
          (card.claudeTaskStatus === 'running' || card.claudeTaskStatus === 'queued') &&
          !processedTasks.has(card.claudeTaskId!)
      );

      for (const card of runningCards) {
        if (!mounted) break;
        try {
          const status = await getRunnerTaskStatus(card.claudeTaskId!);
          if (!mounted) break;

          if (status.done) {
            // Mark as processed so we don't handle it twice
            processedTasks.add(card.claudeTaskId!);

            console.log(`[Poller] Task ${card.claudeTaskId} is done, status: ${status.status}`);

            const { updateCard, moveCard, addComment } = useBoardStore.getState();
            const freshCard = useBoardStore.getState().cards[card.id];
            if (!freshCard) continue;

            updateCard(card.id, { claudeTaskStatus: status.status as 'completed' | 'failed' | 'stopped' });

            if (status.status === 'completed') {
              // Move to Done
              const freshLists = useBoardStore.getState().lists;
              const doneList = board.listIds
                .map(id => freshLists[id])
                .filter(Boolean)
                .find(l => isDoneList(l.title));

              const updatedCard = useBoardStore.getState().cards[card.id];
              if (doneList && updatedCard && updatedCard.listId !== doneList.id) {
                const freshDoneList = useBoardStore.getState().lists[doneList.id];
                if (freshDoneList) {
                  moveCard(card.id, updatedCard.listId, doneList.id, freshDoneList.cardIds.length);
                  addComment(card.id, `✅ Claude Code task completed. Card auto-moved to "${doneList.title}".`);
                  console.log(`[Poller] Moved card "${freshCard.title}" to Done`);
                }
              } else {
                addComment(card.id, `✅ Claude Code task completed.`);
              }

              // Wait for store to settle, then promote next card
              console.log('[Poller] Waiting 500ms before promoting next card...');
              await new Promise(r => setTimeout(r, 500));

              const cardForPromotion = useBoardStore.getState().cards[card.id];
              if (cardForPromotion) {
                console.log(`[Poller] Calling promoteNextCard for group: ${cardForPromotion.taskGroup || '(none)'}`);
                await promoteNextCard(boardId, cardForPromotion);
              }
            } else if (status.status === 'failed') {
              addComment(card.id, `❌ Claude Code task failed (exit code: ${status.exitCode ?? 'unknown'}).`);
            } else if (status.status === 'stopped') {
              addComment(card.id, `⏹️ Claude Code task was stopped.`);
            }
          }
        } catch (e) {
          console.error(`Error polling task ${card.claudeTaskId}:`, e);
        }
      }
    };

    const interval = setInterval(poll, POLL_INTERVAL);
    poll();

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [boardId]);
}
