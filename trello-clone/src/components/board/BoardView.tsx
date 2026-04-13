import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DndContext, closestCorners, DragEndEvent, DragOverEvent, DragStartEvent, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { useBoardStore } from '../../stores/boardStore';
import { useUIStore } from '../../stores/uiStore';
import { Card as CardType } from '../../types';
import { createRunnerTask } from '../../services/claudeRunner';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTaskPoller } from '../../hooks/useTaskPoller';
import { useScheduler } from '../../hooks/useScheduler';
import BoardHeader from './BoardHeader';
import BoardMenu from './BoardMenu';
import List from '../list/List';
import AddList from '../list/AddList';
import CardDetail from '../card/CardDetail';
import Card from '../card/Card';
import AIAssistant from '../assistant/AIAssistant';
import './board.css';

function buildPromptFromCard(card: CardType): string {
  const lines: string[] = [];
  lines.push(`Please implement the following task.`);
  lines.push('', `# Task: ${card.title}`);
  if (card.description) {
    lines.push('', '## Description', card.description);
  }
  if (card.checklists.length > 0) {
    lines.push('', '## Subtasks to complete');
    for (const checklist of card.checklists) {
      if (card.checklists.length > 1) lines.push(`\n### ${checklist.title}`);
      for (const item of checklist.items) {
        lines.push(`- ${item.isChecked ? '[x]' : '[ ]'} ${item.text}`);
      }
    }
  }
  if (!card.description && card.checklists.length === 0) {
    lines.push('', 'Implement this task based on the title. Analyze the codebase, determine what changes are needed, and make them.');
  }
  return lines.join('\n');
}

function isInProgressList(title: string): boolean {
  const t = title.toLowerCase().trim();
  return t.includes('in progress') || t === 'inprogress' || t === 'in-progress';
}

const BoardView: React.FC = () => {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const board = useBoardStore(s => boardId ? s.boards[boardId] : undefined);
  const lists = useBoardStore(s => s.lists);
  const cards = useBoardStore(s => s.cards);
  const moveList = useBoardStore(s => s.moveList);
  const moveCard = useBoardStore(s => s.moveCard);
  const updateCard = useBoardStore(s => s.updateCard);
  const addComment = useBoardStore(s => s.addComment);
  const { activeCardId, closeCard, activeBoardMenuOpen } = useUIStore();
  const setActiveBoardId = useUIStore(s => s.setActiveBoardId);

  // Publish the currently-viewed board so global components (e.g. ClaudeTaskManager
  // in the header) can attribute new runner tasks to this board's memory namespace.
  useEffect(() => {
    setActiveBoardId(boardId ?? null);
    return () => setActiveBoardId(null);
  }, [boardId, setActiveBoardId]);
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [dragType, setDragType] = useState<'list' | 'card' | null>(null);
  const [showAssistant, setShowAssistant] = useState(false);
  const WORKING_DIR = useSettingsStore(s => s.workingDir);

  // Track the original list when drag starts so we know if card actually moved
  const dragOriginalListRef = useRef<string | null>(null);

  // Start polling for Claude Code Runner tasks
  useTaskPoller(boardId ?? '');
  // Start scheduler for scheduled tasks
  useScheduler(boardId ?? '');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const triggerClaudeTask = useCallback(async (cardId: string) => {
    const card = useBoardStore.getState().cards[cardId];
    if (!card || card.claudeTaskId) return;

    const prompt = buildPromptFromCard(card);
    console.log('[Claude Runner] Creating task for card:', card.title);
    try {
      updateCard(cardId, { claudeTaskStatus: 'queued' });
      const selectedModel = useSettingsStore.getState().selectedModel;
      const task = await createRunnerTask(prompt, WORKING_DIR || undefined, undefined, selectedModel || undefined, boardId);
      console.log('[Claude Runner] Task created:', task.id, 'status:', task.status);
      updateCard(cardId, { claudeTaskId: task.id, claudeTaskStatus: task.status });
      addComment(cardId, `🤖 Claude Code task started (ID: ${task.id}). Monitoring for completion…`);
    } catch (e) {
      console.error('[Claude Runner] Failed to create task:', e);
      updateCard(cardId, { claudeTaskStatus: undefined });
      addComment(cardId, `❌ Failed to start Claude Code task: ${String(e)}`);
    }
  }, [updateCard, addComment, WORKING_DIR, boardId]);

  if (!board || !boardId) {
    return (
      <div className="board-not-found">
        <h2>Board not found</h2>
        <button onClick={() => navigate('/')}>Go to home</button>
      </div>
    );
  }

  const boardLists = board.listIds.map(id => lists[id]).filter(Boolean);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const type = active.data.current?.type;
    setDragActiveId(active.id as string);
    setDragType(type);
    // Remember which list the card started in
    if (type === 'card') {
      dragOriginalListRef.current = active.data.current?.listId || null;
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeType = active.data.current?.type;
    const overType = over.data.current?.type;

    if (activeType === 'card') {
      // Get the card's CURRENT listId from the store (not from drag data, which is stale)
      const freshCard = useBoardStore.getState().cards[active.id as string];
      if (!freshCard) return;
      const activeListId = freshCard.listId;
      const overListId = overType === 'card' ? over.data.current?.listId : over.id as string;

      if (activeListId && overListId && activeListId !== overListId) {
        const overList = useBoardStore.getState().lists[overListId];
        if (overList) {
          const overIndex = overType === 'card'
            ? overList.cardIds.indexOf(over.id as string)
            : overList.cardIds.length;
          moveCard(active.id as string, activeListId, overListId, overIndex >= 0 ? overIndex : overList.cardIds.length);
        }
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const cardId = active.id as string;
    const currentDragType = dragType;
    const originalListId = dragOriginalListRef.current;

    setDragActiveId(null);
    setDragType(null);
    dragOriginalListRef.current = null;

    if (currentDragType === 'list' && over && active.id !== over.id) {
      const oldIndex = board.listIds.indexOf(active.id as string);
      const newIndex = board.listIds.indexOf(over.id as string);
      if (oldIndex !== -1 && newIndex !== -1) {
        moveList(boardId, oldIndex, newIndex);
      }
      return;
    }

    if (currentDragType === 'card') {
      // Handle same-list reorder (cross-list already handled in handleDragOver)
      if (over && active.id !== over.id) {
        const freshCard = useBoardStore.getState().cards[cardId];
        if (freshCard) {
          const overListId = over.data.current?.type === 'card'
            ? over.data.current?.listId
            : over.id as string;
          if (freshCard.listId === overListId) {
            const targetList = useBoardStore.getState().lists[overListId];
            if (targetList) {
              const overIndex = over.data.current?.type === 'card'
                ? targetList.cardIds.indexOf(over.id as string)
                : targetList.cardIds.length;
              const currentIndex = targetList.cardIds.indexOf(cardId);
              if (currentIndex !== overIndex) {
                moveCard(cardId, freshCard.listId, overListId, overIndex >= 0 ? overIndex : targetList.cardIds.length);
              }
            }
          }
        }
      }

      // Check if card ended up in "In Progress" list — trigger Claude Code task
      // Use setTimeout to let the store fully settle
      setTimeout(() => {
        const freshCard = useBoardStore.getState().cards[cardId];
        if (!freshCard || freshCard.claudeTaskId) return;

        const currentList = useBoardStore.getState().lists[freshCard.listId];
        if (!currentList) return;

        // Only trigger if the card actually moved TO "In Progress" from a different list
        const movedToNewList = originalListId && originalListId !== freshCard.listId;
        if (movedToNewList && isInProgressList(currentList.title)) {
          console.log('[Claude Runner] Card moved to "' + currentList.title + '", triggering task:', freshCard.title);
          void triggerClaudeTask(cardId);
        }
      }, 150);
    }
  };

  const draggedCard = dragActiveId && dragType === 'card' ? cards[dragActiveId] : null;

  return (
    <div className="board-view" style={{ background: board.background.value }}>
      <BoardHeader board={board} onOpenAssistant={() => setShowAssistant(true)} />
      <div className="board-canvas">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={board.listIds} strategy={horizontalListSortingStrategy}>
            <div className="board-lists">
              {boardLists.map(list => (
                <List key={list.id} list={list} board={board} />
              ))}
              <AddList boardId={boardId} />
            </div>
          </SortableContext>
          <DragOverlay>
            {draggedCard && (
              <div style={{ width: 252, opacity: 0.9 }}>
                <Card card={draggedCard} board={board} isDragging />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {activeBoardMenuOpen && <BoardMenu board={board} />}
      {activeCardId && cards[activeCardId] && (
        <CardDetail card={cards[activeCardId]} board={board} onClose={closeCard} />
      )}
      {showAssistant && (
        <AIAssistant board={board} onClose={() => setShowAssistant(false)} />
      )}
    </div>
  );
};

export default BoardView;
