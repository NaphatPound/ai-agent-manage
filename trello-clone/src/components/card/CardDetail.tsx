import React, { useState, useEffect, useRef } from 'react';
import {
  X, CreditCard, AlignLeft, CheckSquare, Clock, Tag, User, MessageSquare,
  Palette, Trash2, Archive, Plus, MoreHorizontal, Sparkles, Loader2,
  FileText, Copy, Check, ChevronDown, ChevronRight, Download,
  Terminal, Play, Square, Eye, RotateCw, Timer
} from 'lucide-react';
import { Card as CardType, Board } from '../../types';
import { useBoardStore } from '../../stores/boardStore';
import { formatDueDate, getDueDateStatus, getChecklistProgress, formatTimeAgo, getInitials } from '../../utils/helpers';
import { LABEL_COLORS, COVER_COLORS } from '../../utils/colors';
import { generateDescriptionAndChecklist, generateCardFromDescription } from '../../services/ai';
import {
  createRunnerTask, getRunnerTask, stopRunnerTask, stripAnsi,
  type RunnerTask
} from '../../services/claudeRunner';
import { useSettingsStore } from '../../stores/settingsStore';
import Avatar from '../common/Avatar';
import './card-detail.css';

interface CardDetailProps {
  card: CardType;
  board: Board;
  onClose: () => void;
}

const CardDetail: React.FC<CardDetailProps> = ({ card, board, onClose }) => {
  const [editTitle, setEditTitle] = useState(card.title);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editDesc, setEditDesc] = useState(card.description || '');
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [showDueDate, setShowDueDate] = useState(false);
  const [showCover, setShowCover] = useState(false);
  const [checklistTitle, setChecklistTitle] = useState('Checklist');
  const [newChecklistItems, setNewChecklistItems] = useState<Record<string, string>>({});
  const [dueInput, setDueInput] = useState(card.dueDate ? card.dueDate.split('T')[0] : '');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [markdownContent, setMarkdownContent] = useState('');
  const [isCopied, setIsCopied] = useState(false);
  const [showTaskOutput, setShowTaskOutput] = useState(false);
  const [taskOutput, setTaskOutput] = useState('');
  const [isTaskLoading, setIsTaskLoading] = useState(false);
  const [taskError, setTaskError] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleInput, setScheduleInput] = useState(
    card.scheduledAt ? new Date(card.scheduledAt).toISOString().slice(0, 16) : ''
  );

  const updateCard = useBoardStore(s => s.updateCard);
  const deleteCard = useBoardStore(s => s.deleteCard);
  const archiveCard = useBoardStore(s => s.archiveCard);
  const addChecklist = useBoardStore(s => s.addChecklist);
  const deleteChecklist = useBoardStore(s => s.deleteChecklist);
  const addChecklistItem = useBoardStore(s => s.addChecklistItem);
  const toggleChecklistItem = useBoardStore(s => s.toggleChecklistItem);
  const deleteChecklistItem = useBoardStore(s => s.deleteChecklistItem);
  const addComment = useBoardStore(s => s.addComment);
  const deleteComment = useBoardStore(s => s.deleteComment);
  const createLabel = useBoardStore(s => s.createLabel);
  const lists = useBoardStore(s => s.lists);
  const currentList = lists[card.listId];

  const cardLabels = board.labels.filter(l => card.labelIds.includes(l.id));
  const dueDateStatus = card.dueDate ? getDueDateStatus(card.dueDate, card.isDueDateComplete) : null;

  const handleSaveTitle = () => {
    if (editTitle.trim()) updateCard(card.id, { title: editTitle.trim() });
    setIsEditingTitle(false);
  };

  const handleSaveDesc = () => {
    updateCard(card.id, { description: editDesc });
    setIsEditingDesc(false);
  };

  const handleToggleLabel = (labelId: string) => {
    const newLabels = card.labelIds.includes(labelId)
      ? card.labelIds.filter(id => id !== labelId)
      : [...card.labelIds, labelId];
    updateCard(card.id, { labelIds: newLabels });
  };

  const handleAddChecklist = () => {
    addChecklist(card.id, checklistTitle);
    setChecklistTitle('Checklist');
    setShowChecklist(false);
  };

  const handleAddChecklistItem = (checklistId: string) => {
    const text = newChecklistItems[checklistId];
    if (text?.trim()) {
      addChecklistItem(card.id, checklistId, text.trim());
      setNewChecklistItems(prev => ({ ...prev, [checklistId]: '' }));
    }
  };

  const handleAddComment = () => {
    if (commentText.trim()) {
      addComment(card.id, commentText.trim());
      setCommentText('');
    }
  };

  const handleSetDueDate = () => {
    if (dueInput) {
      updateCard(card.id, { dueDate: new Date(dueInput).toISOString() });
    }
    setShowDueDate(false);
  };

  const handleRemoveDueDate = () => {
    updateCard(card.id, { dueDate: undefined, isDueDateComplete: false });
    setDueInput('');
    setShowDueDate(false);
  };

  const handleSetSchedule = () => {
    if (scheduleInput) {
      updateCard(card.id, { scheduledAt: new Date(scheduleInput).toISOString() });
    }
    setShowSchedule(false);
  };

  const handleRemoveSchedule = () => {
    updateCard(card.id, { scheduledAt: undefined });
    setScheduleInput('');
    setShowSchedule(false);
  };

  const handleAiAssist = async () => {
    setIsAiLoading(true);
    setAiError('');
    try {
      const existingLabels = board.labels.map(l => ({ name: l.name, color: l.color }));
      const result = await generateCardFromDescription(card.title, existingLabels);

      // Set description if empty
      if (!card.description) {
        updateCard(card.id, { description: result.description });
        setEditDesc(result.description);
      }

      // Resolve AI-suggested labels: reuse existing or create new ones
      if (result.labels && result.labels.length > 0 && card.labelIds.length === 0) {
        const labelIds: string[] = [];
        const currentBoard = useBoardStore.getState().boards[board.id];
        for (const aiLabel of result.labels) {
          const existing = currentBoard?.labels.find(
            l => l.name.toLowerCase() === aiLabel.name.toLowerCase()
          );
          if (existing) {
            labelIds.push(existing.id);
          } else {
            const newLabel = createLabel(board.id, aiLabel.name, aiLabel.color);
            labelIds.push(newLabel.id);
          }
        }
        updateCard(card.id, { labelIds });
      }

      // Auto-assign AI member if not already assigned
      if (!card.memberIds.includes('member-ai')) {
        updateCard(card.id, { memberIds: [...card.memberIds, 'member-ai'] });
      }

      // Add checklist with generated items
      if (result.checklist.length > 0) {
        addChecklist(card.id, 'Tasks');
        const updatedCards = useBoardStore.getState().cards;
        const updatedCard = updatedCards[card.id];
        if (updatedCard) {
          const newChecklist = updatedCard.checklists[updatedCard.checklists.length - 1];
          if (newChecklist) {
            for (const item of result.checklist) {
              addChecklistItem(card.id, newChecklist.id, item);
            }
          }
        }
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI generation failed');
    } finally {
      setIsAiLoading(false);
    }
  };

  const WORKING_DIR = useSettingsStore(s => s.workingDir);

  const handleRunClaudeTask = async () => {
    if (card.claudeTaskId) return;
    setIsTaskLoading(true);
    setTaskError('');
    try {
      const lines: string[] = [];
      lines.push('Please implement the following task.');
      lines.push('', `# Task: ${card.title}`);
      if (card.description) lines.push('', '## Description', card.description);
      if (card.checklists.length > 0) {
        lines.push('', '## Subtasks');
        for (const cl of card.checklists) {
          for (const item of cl.items) {
            lines.push(`- ${item.isChecked ? '[x]' : '[ ]'} ${item.text}`);
          }
        }
      }
      if (!card.description && card.checklists.length === 0) {
        lines.push('', 'Implement this task based on the title. Analyze the codebase, determine what changes are needed, and make them.');
      }
      const prompt = lines.join('\n');

      updateCard(card.id, { claudeTaskStatus: 'queued' });
      const selectedModel = useSettingsStore.getState().selectedModel;
      const task = await createRunnerTask(prompt, WORKING_DIR || undefined, undefined, selectedModel || undefined, card.boardId);
      updateCard(card.id, { claudeTaskId: task.id, claudeTaskStatus: task.status });
      addComment(card.id, `🤖 Claude Code task started (ID: ${task.id.slice(0, 8)}...).`);
    } catch (e) {
      updateCard(card.id, { claudeTaskStatus: undefined });
      setTaskError(String(e));
    } finally {
      setIsTaskLoading(false);
    }
  };

  const handleViewTaskOutput = async () => {
    if (!card.claudeTaskId) return;
    setShowTaskOutput(true);
    setTaskOutput('Loading...');
    try {
      const task = await getRunnerTask(card.claudeTaskId);
      setTaskOutput(stripAnsi(task.output) || 'No output yet.');
    } catch (e) {
      setTaskOutput(`Error loading output: ${String(e)}`);
    }
  };

  const handleStopClaudeTask = async () => {
    if (!card.claudeTaskId) return;
    try {
      await stopRunnerTask(card.claudeTaskId);
      updateCard(card.id, { claudeTaskStatus: 'stopped' });
      addComment(card.id, '⏹️ Claude Code task was stopped manually.');
    } catch (e) {
      setTaskError(String(e));
    }
  };

  const generateMarkdown = () => {
    const cardMembers = board.members.filter(m => card.memberIds.includes(m.id));
    const lines: string[] = [];

    lines.push(`# ${card.title}`);
    lines.push('');

    // Meta info
    lines.push(`**List:** ${currentList?.title || 'Unknown'}`);
    if (cardLabels.length > 0) {
      lines.push(`**Labels:** ${cardLabels.map(l => l.name).join(', ')}`);
    }
    if (cardMembers.length > 0) {
      lines.push(`**Members:** ${cardMembers.map(m => m.name).join(', ')}`);
    }
    if (card.dueDate) {
      const status = card.isDueDateComplete ? 'Complete' : dueDateStatus === 'overdue' ? 'Overdue' : '';
      lines.push(`**Due Date:** ${formatDueDate(card.dueDate)}${status ? ` (${status})` : ''}`);
    }
    lines.push('');

    // Description
    if (card.description) {
      lines.push('## Description');
      lines.push('');
      lines.push(card.description);
      lines.push('');
    }

    // Checklists
    for (const checklist of card.checklists) {
      const progress = getChecklistProgress(checklist.items);
      lines.push(`## ${checklist.title} (${progress.percent}%)`);
      lines.push('');
      for (const item of checklist.items) {
        lines.push(`- [${item.isChecked ? 'x' : ' '}] ${item.text}`);
      }
      lines.push('');
    }

    // Comments
    if (card.comments.length > 0) {
      lines.push('## Comments');
      lines.push('');
      for (const comment of card.comments) {
        const author = board.members.find(m => m.id === comment.memberId)?.name || 'Unknown';
        lines.push(`> **${author}** - ${formatTimeAgo(comment.createdAt)}`);
        lines.push(`> ${comment.text}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  };

  const handleConvertToMarkdown = () => {
    const md = generateMarkdown();
    setMarkdownContent(md);
    setShowMarkdown(true);
    setIsCopied(false);
  };

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdownContent);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = markdownContent;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const handleDownloadMarkdown = () => {
    const blob = new Blob([markdownContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${card.title.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDelete = () => {
    if (window.confirm('Delete this card? This cannot be undone.')) {
      deleteCard(card.id);
      onClose();
    }
  };

  return (
    <div className="card-detail-backdrop" onClick={onClose}>
      <div className="card-detail animate-scale-in" onClick={e => e.stopPropagation()}>
        <button className="card-detail-close" onClick={onClose}><X size={20} /></button>

        {/* Cover */}
        {card.coverColor && (
          <div className="card-detail-cover" style={{ backgroundColor: card.coverColor }} />
        )}

        <div className="card-detail-body">
          {/* Main Content */}
          <div className="card-detail-main">
            {/* Title */}
            <div className="card-detail-title-area">
              <CreditCard size={20} className="card-detail-icon" />
              <div style={{ flex: 1 }}>
                {isEditingTitle ? (
                  <input
                    type="text"
                    className="card-detail-title-input"
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    onBlur={handleSaveTitle}
                    onKeyDown={e => e.key === 'Enter' && handleSaveTitle()}
                    autoFocus
                  />
                ) : (
                  <h2 className="card-detail-title" onClick={() => setIsEditingTitle(true)}>
                    {card.title}
                  </h2>
                )}
                <p className="card-detail-list-info">
                  in list <strong>{currentList?.title || 'Unknown'}</strong>
                </p>
              </div>
            </div>

            {/* Priority, Group, Labels, Members, Due Date Row */}
            <div className="card-detail-meta">
              {card.priority && (
                <div className="card-detail-meta-item">
                  <span className="card-detail-meta-label">Priority</span>
                  <span className={`card-detail-priority-badge card-detail-priority-badge--${card.priority}`}>
                    {card.priority}
                  </span>
                </div>
              )}
              {card.taskGroup && (
                <div className="card-detail-meta-item">
                  <span className="card-detail-meta-label">Task Group</span>
                  <span className="card-detail-group-badge">
                    {card.taskGroup}{card.taskOrder ? ` — Step #${card.taskOrder}` : ''}
                  </span>
                </div>
              )}
              {card.memberIds.length > 0 && (
                <div className="card-detail-meta-item">
                  <span className="card-detail-meta-label">Members</span>
                  <div className="card-detail-meta-avatars">
                    {board.members.filter(m => card.memberIds.includes(m.id)).map(m => (
                      <Avatar key={m.id} name={m.name} color={m.color} size="md" isAI={m.id === 'member-ai'} />
                    ))}
                  </div>
                </div>
              )}
              {cardLabels.length > 0 && (
                <div className="card-detail-meta-item">
                  <span className="card-detail-meta-label">Labels</span>
                  <div className="card-detail-meta-labels">
                    {cardLabels.map(l => (
                      <span key={l.id} className="card-detail-label-pill" style={{ backgroundColor: l.color }}>
                        {l.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {card.dueDate && (
                <div className="card-detail-meta-item">
                  <span className="card-detail-meta-label">Due date</span>
                  <div className={`card-detail-due-badge card-detail-due-badge--${dueDateStatus}`}>
                    <input
                      type="checkbox"
                      checked={card.isDueDateComplete}
                      onChange={() => updateCard(card.id, { isDueDateComplete: !card.isDueDateComplete })}
                    />
                    <span>{formatDueDate(card.dueDate)}</span>
                    {dueDateStatus === 'overdue' && <span className="card-detail-due-tag">Overdue</span>}
                    {dueDateStatus === 'due-soon' && <span className="card-detail-due-tag">Due soon</span>}
                    {dueDateStatus === 'complete' && <span className="card-detail-due-tag">Complete</span>}
                  </div>
                </div>
              )}
              {card.scheduledAt && (
                <div className="card-detail-meta-item">
                  <span className="card-detail-meta-label">Scheduled execution</span>
                  <div className={`card-detail-schedule-badge ${new Date(card.scheduledAt) <= new Date() ? 'card-detail-schedule-badge--due' : ''}`}>
                    <Timer size={14} />
                    <span>{new Date(card.scheduledAt).toLocaleString()}</span>
                    {new Date(card.scheduledAt) <= new Date() && <span className="card-detail-due-tag">Pending trigger</span>}
                  </div>
                </div>
              )}
            </div>

            {/* Description */}
            <div className="card-detail-section">
              <div className="card-detail-section-header">
                <AlignLeft size={20} className="card-detail-icon" />
                <h3>Description</h3>
              </div>
              {isEditingDesc ? (
                <div className="card-detail-desc-edit">
                  <textarea
                    className="card-detail-desc-textarea"
                    value={editDesc}
                    onChange={e => setEditDesc(e.target.value)}
                    placeholder="Add a more detailed description..."
                    autoFocus
                  />
                  <div className="card-detail-desc-actions">
                    <button className="btn-primary" onClick={handleSaveDesc}>Save</button>
                    <button className="btn-secondary" onClick={() => { setEditDesc(card.description || ''); setIsEditingDesc(false); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div
                  className={`card-detail-desc-display ${!card.description ? 'card-detail-desc-empty' : ''}`}
                  onClick={() => setIsEditingDesc(true)}
                >
                  {card.description || 'Add a more detailed description...'}
                </div>
              )}
            </div>

            {/* Checklists */}
            {card.checklists.map(checklist => {
              const progress = getChecklistProgress(checklist.items);
              return (
                <div key={checklist.id} className="card-detail-section">
                  <div className="card-detail-section-header">
                    <CheckSquare size={20} className="card-detail-icon" />
                    <h3>{checklist.title}</h3>
                    <button
                      className="btn-secondary btn-sm"
                      onClick={() => deleteChecklist(card.id, checklist.id)}
                      style={{ marginLeft: 'auto' }}
                    >
                      Delete
                    </button>
                  </div>
                  <div className="checklist-progress">
                    <span className="checklist-progress-text">{progress.percent}%</span>
                    <div className="checklist-progress-bar">
                      <div
                        className={`checklist-progress-fill ${progress.percent === 100 ? 'checklist-progress-fill--complete' : ''}`}
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>
                  </div>
                  <div className="checklist-items">
                    {checklist.items.map(item => (
                      <div key={item.id} className="checklist-item">
                        <input
                          type="checkbox"
                          checked={item.isChecked}
                          onChange={() => toggleChecklistItem(card.id, checklist.id, item.id)}
                        />
                        <span className={`checklist-item-text ${item.isChecked ? 'checklist-item-text--checked' : ''}`}>
                          {item.text}
                        </span>
                        <button
                          className="checklist-item-delete"
                          onClick={() => deleteChecklistItem(card.id, checklist.id, item.id)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    <div className="checklist-add-item">
                      <input
                        type="text"
                        placeholder="Add an item..."
                        value={newChecklistItems[checklist.id] || ''}
                        onChange={e => setNewChecklistItems(prev => ({ ...prev, [checklist.id]: e.target.value }))}
                        onKeyDown={e => e.key === 'Enter' && handleAddChecklistItem(checklist.id)}
                      />
                      <button
                        className="btn-primary btn-sm"
                        onClick={() => handleAddChecklistItem(checklist.id)}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Comments */}
            <div className="card-detail-section">
              <div className="card-detail-section-header">
                <MessageSquare size={20} className="card-detail-icon" />
                <h3>Activity</h3>
              </div>
              <div className="comment-input-area">
                <Avatar name="You" color="#0079BF" size="md" />
                <div className="comment-input-wrapper">
                  <textarea
                    className="comment-textarea"
                    placeholder="Write a comment..."
                    value={commentText}
                    onChange={e => setCommentText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleAddComment();
                      }
                    }}
                  />
                  {commentText && (
                    <button className="btn-primary" onClick={handleAddComment}>Save</button>
                  )}
                </div>
              </div>
              <div className="comment-list">
                {card.comments.map(comment => (
                  <div key={comment.id} className="comment">
                    <Avatar name="You" color="#0079BF" size="md" />
                    <div className="comment-body">
                      <div className="comment-header">
                        <span className="comment-author">You</span>
                        <span className="comment-time">{formatTimeAgo(comment.createdAt)}</span>
                      </div>
                      <p className="comment-text">{comment.text}</p>
                      <div className="comment-actions-row">
                        <button onClick={() => deleteComment(card.id, comment.id)}>Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Claude Code Task Output */}
            {showTaskOutput && (
              <div className="card-detail-section">
                <div className="card-detail-section-header">
                  <Terminal size={20} className="card-detail-icon" />
                  <h3>Claude Code Output</h3>
                  <div className="md-header-actions">
                    {card.claudeTaskStatus && (
                      <span className={`card-detail-task-status card-detail-task-status--${card.claudeTaskStatus}`}>
                        {card.claudeTaskStatus}
                      </span>
                    )}
                    <button className="md-action-btn" onClick={handleViewTaskOutput} title="Refresh output">
                      <RotateCw size={14} />
                      Refresh
                    </button>
                    <button className="md-action-btn" onClick={() => setShowTaskOutput(false)} title="Hide">
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="card-detail-terminal-output">
                  <pre>{taskOutput}</pre>
                </div>
              </div>
            )}

            {/* Markdown Export */}
            {showMarkdown && markdownContent && (
              <div className="card-detail-section">
                <div className="card-detail-section-header">
                  <FileText size={20} className="card-detail-icon" />
                  <h3>Markdown</h3>
                  <div className="md-header-actions">
                    <button
                      className="md-action-btn"
                      onClick={handleCopyMarkdown}
                      title="Copy to clipboard"
                    >
                      {isCopied ? <Check size={14} /> : <Copy size={14} />}
                      {isCopied ? 'Copied!' : 'Copy'}
                    </button>
                    <button
                      className="md-action-btn"
                      onClick={handleDownloadMarkdown}
                      title="Download .md file"
                    >
                      <Download size={14} />
                      Download
                    </button>
                    <button
                      className="md-action-btn"
                      onClick={() => setShowMarkdown(false)}
                      title="Hide markdown"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="md-preview">
                  <pre className="md-content">{markdownContent}</pre>
                </div>
              </div>
            )}
          </div>

          {/* Sidebar Actions */}
          <div className="card-detail-sidebar">
            <span className="card-detail-sidebar-title">Add to card</span>

            {/* Priority */}
            <div className="card-detail-priority-selector">
              <span className="card-detail-priority-label">Priority</span>
              <div className="card-detail-priority-options">
                {(['critical', 'high', 'medium', 'low'] as const).map(p => (
                  <button
                    key={p}
                    className={`card-detail-priority-option card-detail-priority-option--${p} ${card.priority === p ? 'card-detail-priority-option--active' : ''}`}
                    onClick={() => updateCard(card.id, { priority: card.priority === p ? undefined : p })}
                    title={p}
                  >
                    {p.charAt(0).toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Members */}
            <div style={{ position: 'relative' }}>
              <button className="card-detail-action-btn" onClick={() => setShowMembers(!showMembers)}>
                <User size={16} /> Members
              </button>
              {showMembers && (
                <div className="card-detail-popover">
                  <div className="card-detail-popover-header">
                    <span>Members</span>
                    <button onClick={() => setShowMembers(false)}><X size={14} /></button>
                  </div>
                  <div className="card-detail-popover-body">
                    {board.members.map(member => (
                      <label key={member.id} className="member-option">
                        <input
                          type="checkbox"
                          checked={card.memberIds.includes(member.id)}
                          onChange={() => {
                            const newMembers = card.memberIds.includes(member.id)
                              ? card.memberIds.filter(id => id !== member.id)
                              : [...card.memberIds, member.id];
                            updateCard(card.id, { memberIds: newMembers });
                          }}
                        />
                        <Avatar name={member.name} color={member.color} size="sm" isAI={member.id === 'member-ai'} />
                        <span className="member-option-name">{member.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Labels */}
            <div style={{ position: 'relative' }}>
              <button className="card-detail-action-btn" onClick={() => setShowLabels(!showLabels)}>
                <Tag size={16} /> Labels
              </button>
              {showLabels && (
                <div className="card-detail-popover">
                  <div className="card-detail-popover-header">
                    <span>Labels</span>
                    <button onClick={() => setShowLabels(false)}><X size={14} /></button>
                  </div>
                  <div className="card-detail-popover-body">
                    {board.labels.map(label => (
                      <label key={label.id} className="label-option">
                        <input
                          type="checkbox"
                          checked={card.labelIds.includes(label.id)}
                          onChange={() => handleToggleLabel(label.id)}
                        />
                        <span className="label-option-color" style={{ backgroundColor: label.color }}>
                          {label.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Checklist */}
            <div style={{ position: 'relative' }}>
              <button className="card-detail-action-btn" onClick={() => setShowChecklist(!showChecklist)}>
                <CheckSquare size={16} /> Checklist
              </button>
              {showChecklist && (
                <div className="card-detail-popover">
                  <div className="card-detail-popover-header">
                    <span>Add checklist</span>
                    <button onClick={() => setShowChecklist(false)}><X size={14} /></button>
                  </div>
                  <div className="card-detail-popover-body">
                    <input
                      type="text"
                      className="popover-input"
                      value={checklistTitle}
                      onChange={e => setChecklistTitle(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAddChecklist()}
                      autoFocus
                    />
                    <button className="btn-primary btn-sm" onClick={handleAddChecklist}>Add</button>
                  </div>
                </div>
              )}
            </div>

            {/* Due Date */}
            <div style={{ position: 'relative' }}>
              <button className="card-detail-action-btn" onClick={() => setShowDueDate(!showDueDate)}>
                <Clock size={16} /> Due date
              </button>
              {showDueDate && (
                <div className="card-detail-popover">
                  <div className="card-detail-popover-header">
                    <span>Due date</span>
                    <button onClick={() => setShowDueDate(false)}><X size={14} /></button>
                  </div>
                  <div className="card-detail-popover-body">
                    <input
                      type="date"
                      className="popover-input"
                      value={dueInput}
                      onChange={e => setDueInput(e.target.value)}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-primary btn-sm" onClick={handleSetDueDate}>Save</button>
                      <button className="btn-secondary btn-sm" onClick={handleRemoveDueDate}>Remove</button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Schedule */}
            <div style={{ position: 'relative' }}>
              <button className="card-detail-action-btn card-detail-action-btn--schedule" onClick={() => setShowSchedule(!showSchedule)}>
                <Timer size={16} /> Schedule
                {card.scheduledAt && <span className="card-detail-action-tag">Set</span>}
              </button>
              {showSchedule && (
                <div className="card-detail-popover">
                  <div className="card-detail-popover-header">
                    <span>Schedule execution</span>
                    <button onClick={() => setShowSchedule(false)}><X size={14} /></button>
                  </div>
                  <div className="card-detail-popover-body">
                    <p className="card-detail-schedule-hint">
                      Set a date and time for this task to auto-execute via Claude Code Runner.
                    </p>
                    <input
                      type="datetime-local"
                      className="popover-input"
                      value={scheduleInput}
                      onChange={e => setScheduleInput(e.target.value)}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn-primary btn-sm" onClick={handleSetSchedule} disabled={!scheduleInput}>Save</button>
                      {card.scheduledAt && (
                        <button className="btn-secondary btn-sm" onClick={handleRemoveSchedule}>Remove</button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Cover */}
            <div style={{ position: 'relative' }}>
              <button className="card-detail-action-btn" onClick={() => setShowCover(!showCover)}>
                <Palette size={16} /> Cover
              </button>
              {showCover && (
                <div className="card-detail-popover">
                  <div className="card-detail-popover-header">
                    <span>Cover</span>
                    <button onClick={() => setShowCover(false)}><X size={14} /></button>
                  </div>
                  <div className="card-detail-popover-body">
                    <div className="cover-color-grid">
                      {COVER_COLORS.map(color => (
                        <button
                          key={color}
                          className={`cover-color-btn ${card.coverColor === color ? 'cover-color-btn--selected' : ''}`}
                          style={{ backgroundColor: color }}
                          onClick={() => updateCard(card.id, { coverColor: color })}
                        />
                      ))}
                    </div>
                    {card.coverColor && (
                      <button
                        className="btn-secondary btn-sm"
                        onClick={() => updateCard(card.id, { coverColor: undefined })}
                        style={{ marginTop: 8 }}
                      >
                        Remove cover
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* AI Assist */}
            <button
              className="card-detail-action-btn card-detail-action-btn--ai"
              onClick={handleAiAssist}
              disabled={isAiLoading}
            >
              {isAiLoading ? <Loader2 size={16} className="ai-spinner" /> : <Sparkles size={16} />}
              {isAiLoading ? 'Generating...' : 'AI Assist'}
            </button>
            {aiError && <div className="ai-error ai-error--sidebar">{aiError}</div>}

            {/* Claude Code Runner */}
            {!card.claudeTaskId ? (
              <button
                className="card-detail-action-btn card-detail-action-btn--claude"
                onClick={handleRunClaudeTask}
                disabled={isTaskLoading}
              >
                {isTaskLoading ? <Loader2 size={16} className="ai-spinner" /> : <Terminal size={16} />}
                {isTaskLoading ? 'Starting...' : 'Run with Claude'}
              </button>
            ) : (
              <>
                <button
                  className="card-detail-action-btn card-detail-action-btn--claude"
                  onClick={handleViewTaskOutput}
                >
                  <Eye size={16} />
                  View Task Output
                </button>
                {(card.claudeTaskStatus === 'running' || card.claudeTaskStatus === 'queued') && (
                  <button
                    className="card-detail-action-btn card-detail-action-btn--danger"
                    onClick={handleStopClaudeTask}
                  >
                    <Square size={16} /> Stop Task
                  </button>
                )}
              </>
            )}
            {taskError && <div className="ai-error ai-error--sidebar">{taskError}</div>}

            {/* Export to Markdown */}
            <button
              className="card-detail-action-btn card-detail-action-btn--md"
              onClick={handleConvertToMarkdown}
            >
              <FileText size={16} />
              {showMarkdown ? 'Refresh .md' : 'Convert to .md'}
            </button>

            <span className="card-detail-sidebar-title" style={{ marginTop: 16 }}>Actions</span>
            <button className="card-detail-action-btn" onClick={() => { archiveCard(card.id); onClose(); }}>
              <Archive size={16} /> Archive
            </button>
            <button className="card-detail-action-btn card-detail-action-btn--danger" onClick={handleDelete}>
              <Trash2 size={16} /> Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CardDetail;
