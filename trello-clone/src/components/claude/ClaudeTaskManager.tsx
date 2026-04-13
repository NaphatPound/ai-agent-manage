import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Plus, Square, Trash2, RotateCw, Terminal, ChevronDown, ChevronRight,
  Loader2, CircleCheck, CircleX, Clock, Play, Maximize2, Minimize2,
  FolderOpen, Wifi, WifiOff, Cpu
} from 'lucide-react';
import {
  listRunnerTasks, getRunnerTask, createRunnerTask, stopRunnerTask,
  deleteRunnerTask, connectRunnerWs, listModels,
  type RunnerTask, type RunnerTaskSummary, type RunnerWebSocket, type WsMessage, type RunnerModel
} from '../../services/claudeRunner';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import XtermTerminal, { XtermTerminalHandle } from './XtermTerminal';
import './claude-task-manager.css';

interface ClaudeTaskManagerProps {
  onClose: () => void;
}

const ClaudeTaskManager: React.FC<ClaudeTaskManagerProps> = ({ onClose }) => {
  const WORKING_DIR = useSettingsStore(s => s.workingDir);
  const globalModel = useSettingsStore(s => s.selectedModel);
  const activeBoardId = useUIStore(s => s.activeBoardId);
  const runnerFocusTaskId = useUIStore(s => s.runnerFocusTaskId);
  const setRunnerFocusTaskId = useUIStore(s => s.setRunnerFocusTaskId);
  const clearAwaitingUser = useUIStore(s => s.clearAwaitingUser);
  const [tasks, setTasks] = useState<RunnerTaskSummary[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<RunnerTask | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showNewTask, setShowNewTask] = useState(false);
  const [newPrompt, setNewPrompt] = useState('');
  const [newWorkingDir, setNewWorkingDir] = useState(WORKING_DIR);
  const [newModel, setNewModel] = useState(globalModel);
  const [models, setModels] = useState<RunnerModel[]>([]);
  // Sync defaults when settings change
  useEffect(() => { setNewWorkingDir(WORKING_DIR); }, [WORKING_DIR]);
  useEffect(() => { setNewModel(globalModel); }, [globalModel]);
  const [isCreating, setIsCreating] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  const wsRef = useRef<RunnerWebSocket | null>(null);
  const xtermRef = useRef<XtermTerminalHandle | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch all tasks
  const fetchTasks = useCallback(async () => {
    try {
      const data = await listRunnerTasks();
      setTasks(data);
      setError('');
    } catch (e) {
      setError(`Cannot connect to Claude Code Runner: ${String(e)}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load + polling
  useEffect(() => {
    fetchTasks();
    listModels().then(setModels).catch(() => {});
    refreshTimer.current = setInterval(fetchTasks, 5000);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [fetchTasks]);

  // Auto-focus a task that was opened from the awaiting-user toast.
  useEffect(() => {
    if (!runnerFocusTaskId) return;
    selectTask(runnerFocusTaskId);
    // The awaiting banner lingers until the user actually answers; we clear
    // the focus id so re-opening the panel doesn't keep re-selecting the
    // same task if the user has since picked a different one.
    setRunnerFocusTaskId(null);
    clearAwaitingUser(runnerFocusTaskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnerFocusTaskId]);

  // WebSocket connection
  useEffect(() => {
    const ws = connectRunnerWs();
    wsRef.current = ws;

    ws.onMessage((msg: WsMessage) => {
      if (msg.type === 'output') {
        // Pipe raw PTY bytes (ANSI and all) straight into xterm.js
        xtermRef.current?.write(msg.data);
      } else if (msg.type === 'status') {
        // Refresh task list on status change
        fetchTasks();
        if (msg.status === 'completed' || msg.status === 'failed' || msg.status === 'stopped') {
          // Refresh selected task details
          setSelectedTask(prev =>
            prev ? { ...prev, status: msg.status as RunnerTask['status'], finishedAt: msg.finishedAt || null, exitCode: msg.exitCode ?? null } : null
          );
        }
      }
    });

    ws.onClose(() => setWsConnected(false));

    // Check connection status periodically
    const wsCheckInterval = setInterval(() => {
      setWsConnected(ws.isConnected());
    }, 1000);

    return () => {
      clearInterval(wsCheckInterval);
      ws.close();
    };
  }, [fetchTasks]);

  // Select a task
  const selectTask = useCallback(async (taskId: string) => {
    setSelectedTaskId(taskId);
    // Reset the xterm buffer to the current task's backlog. The terminal
    // component also resets when `sessionKey` changes, but doing it here
    // makes the swap feel instant.
    xtermRef.current?.clear();
    try {
      const task = await getRunnerTask(taskId);
      setSelectedTask(task);
      if (task.output) xtermRef.current?.write(task.output);
      // Subscribe via WebSocket for live updates
      wsRef.current?.subscribe(taskId);
      // Send current terminal size so the PTY can match
      setTimeout(() => {
        const size = xtermRef.current?.getSize();
        if (size) wsRef.current?.resize(size.cols, size.rows);
        xtermRef.current?.focus();
      }, 150);
    } catch (e) {
      setError(`Failed to load task: ${String(e)}`);
    }
  }, []);

  // Create new task
  const handleCreateTask = async () => {
    if (!newPrompt.trim()) return;
    setIsCreating(true);
    try {
      const task = await createRunnerTask(
        newPrompt.trim(),
        newWorkingDir || undefined,
        undefined,
        newModel || undefined,
        activeBoardId || undefined,
      );
      setNewPrompt('');
      setShowNewTask(false);
      await fetchTasks();
      selectTask(task.id);
    } catch (e) {
      setError(`Failed to create task: ${String(e)}`);
    } finally {
      setIsCreating(false);
    }
  };

  // Stop a task
  const handleStopTask = async (taskId: string) => {
    try {
      await stopRunnerTask(taskId);
      fetchTasks();
      if (selectedTaskId === taskId) {
        const task = await getRunnerTask(taskId);
        setSelectedTask(task);
      }
    } catch (e) {
      setError(`Failed to stop task: ${String(e)}`);
    }
  };

  // Delete a task
  const handleDeleteTask = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this task?')) return;
    try {
      await deleteRunnerTask(taskId);
      if (selectedTaskId === taskId) {
        setSelectedTaskId(null);
        setSelectedTask(null);
        setTerminalOutput('');
        wsRef.current?.unsubscribe();
      }
      fetchTasks();
    } catch (err) {
      setError(`Failed to delete task: ${String(err)}`);
    }
  };

  // Forward every keystroke typed into xterm straight to the PTY.
  const handleTerminalData = useCallback((data: string) => {
    wsRef.current?.sendInput(data);
  }, []);

  // Forward terminal resize events to the PTY so line wrapping stays correct.
  const handleTerminalResize = useCallback((cols: number, rows: number) => {
    wsRef.current?.resize(cols, rows);
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'running':
      case 'queued':
        return <Loader2 size={14} className="ctm-spin" />;
      case 'completed':
        return <CircleCheck size={14} />;
      case 'failed':
      case 'stopped':
        return <CircleX size={14} />;
      default:
        return <Clock size={14} />;
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'running': return 'ctm-status--running';
      case 'queued': return 'ctm-status--queued';
      case 'completed': return 'ctm-status--completed';
      case 'failed': return 'ctm-status--failed';
      case 'stopped': return 'ctm-status--stopped';
      default: return '';
    }
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className={`ctm-backdrop ${isFullscreen ? 'ctm-backdrop--fullscreen' : ''}`} onClick={onClose}>
      <div className={`ctm-panel ${isFullscreen ? 'ctm-panel--fullscreen' : ''}`} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="ctm-header">
          <div className="ctm-header-left">
            <Terminal size={18} />
            <span className="ctm-header-title">Claude Code Runner</span>
            <span className={`ctm-ws-badge ${wsConnected ? 'ctm-ws-badge--connected' : ''}`}>
              {wsConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
              {wsConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <div className="ctm-header-actions">
            <button className="ctm-icon-btn" onClick={() => setIsFullscreen(!isFullscreen)} title={isFullscreen ? 'Minimize' : 'Maximize'}>
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button className="ctm-icon-btn" onClick={onClose} title="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="ctm-body">
          {/* Sidebar - Task List */}
          <div className="ctm-sidebar">
            <div className="ctm-sidebar-header">
              <span>Tasks ({tasks.length})</span>
              <div className="ctm-sidebar-actions">
                <button className="ctm-icon-btn ctm-icon-btn--sm" onClick={fetchTasks} title="Refresh">
                  <RotateCw size={14} />
                </button>
                <button className="ctm-icon-btn ctm-icon-btn--sm ctm-icon-btn--primary" onClick={() => setShowNewTask(true)} title="New Task">
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {/* New Task Form */}
            {showNewTask && (
              <div className="ctm-new-task">
                <textarea
                  className="ctm-new-task-input"
                  placeholder="Enter task prompt for Claude Code..."
                  value={newPrompt}
                  onChange={e => setNewPrompt(e.target.value)}
                  rows={3}
                  autoFocus
                />
                <div className="ctm-new-task-dir">
                  <FolderOpen size={12} />
                  <input
                    type="text"
                    className="ctm-new-task-dir-input"
                    placeholder="Working directory (optional)"
                    value={newWorkingDir}
                    onChange={e => setNewWorkingDir(e.target.value)}
                  />
                </div>
                <div className="ctm-new-task-model">
                  <Cpu size={12} />
                  <select
                    className="ctm-new-task-model-select"
                    value={newModel}
                    onChange={e => setNewModel(e.target.value)}
                  >
                    <option value="">Default model</option>
                    {models.map(m => (
                      <option key={m.id} value={m.id}>{m.name || m.id}</option>
                    ))}
                  </select>
                </div>
                <div className="ctm-new-task-actions">
                  <button className="ctm-btn ctm-btn--secondary" onClick={() => setShowNewTask(false)}>
                    Cancel
                  </button>
                  <button
                    className="ctm-btn ctm-btn--primary"
                    onClick={handleCreateTask}
                    disabled={!newPrompt.trim() || isCreating}
                  >
                    {isCreating ? <Loader2 size={14} className="ctm-spin" /> : <Play size={14} />}
                    {isCreating ? 'Creating...' : 'Run Task'}
                  </button>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="ctm-error">
                <CircleX size={14} />
                <span>{error}</span>
                <button onClick={() => setError('')}><X size={12} /></button>
              </div>
            )}

            {/* Task List */}
            <div className="ctm-task-list">
              {isLoading ? (
                <div className="ctm-loading">
                  <Loader2 size={20} className="ctm-spin" />
                  <span>Loading tasks...</span>
                </div>
              ) : tasks.length === 0 ? (
                <div className="ctm-empty">
                  <Terminal size={24} />
                  <span>No tasks yet</span>
                  <button className="ctm-btn ctm-btn--primary ctm-btn--sm" onClick={() => setShowNewTask(true)}>
                    <Plus size={14} /> Create Task
                  </button>
                </div>
              ) : (
                tasks.map(task => (
                  <div
                    key={task.id}
                    className={`ctm-task-item ${selectedTaskId === task.id ? 'ctm-task-item--selected' : ''}`}
                    onClick={() => selectTask(task.id)}
                  >
                    <div className="ctm-task-item-header">
                      <span className={`ctm-status-badge ${getStatusClass(task.status)}`}>
                        {getStatusIcon(task.status)}
                        {task.status}
                      </span>
                      <div className="ctm-task-item-actions">
                        {(task.status === 'running' || task.status === 'queued') && (
                          <button
                            className="ctm-icon-btn ctm-icon-btn--sm ctm-icon-btn--danger"
                            onClick={(e) => { e.stopPropagation(); handleStopTask(task.id); }}
                            title="Stop"
                          >
                            <Square size={12} />
                          </button>
                        )}
                        <button
                          className="ctm-icon-btn ctm-icon-btn--sm ctm-icon-btn--danger"
                          onClick={(e) => handleDeleteTask(task.id, e)}
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <p className="ctm-task-item-prompt">{task.prompt}</p>
                    <span className="ctm-task-item-time">{formatTime(task.createdAt)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Main Content - Terminal Output */}
          <div className="ctm-main">
            {selectedTask ? (
              <>
                <div className="ctm-terminal-header">
                  <div className="ctm-terminal-info">
                    <span className={`ctm-status-badge ${getStatusClass(selectedTask.status)}`}>
                      {getStatusIcon(selectedTask.status)}
                      {selectedTask.status}
                    </span>
                    <span className="ctm-terminal-id">ID: {selectedTask.id.slice(0, 8)}...</span>
                    {selectedTask.exitCode !== null && (
                      <span className="ctm-terminal-exit">Exit: {selectedTask.exitCode}</span>
                    )}
                  </div>
                  <div className="ctm-terminal-meta">
                    <span>Started: {formatTime(selectedTask.startedAt)}</span>
                    {selectedTask.finishedAt && <span>Finished: {formatTime(selectedTask.finishedAt)}</span>}
                  </div>
                  <div className="ctm-terminal-prompt-preview">
                    <strong>Prompt:</strong> {selectedTask.prompt}
                  </div>
                  {selectedTask.workingDir && (
                    <div className="ctm-terminal-workdir">
                      <FolderOpen size={12} />
                      <span>{selectedTask.workingDir}</span>
                    </div>
                  )}
                </div>
                <div className="ctm-terminal-wrap">
                  <XtermTerminal
                    ref={xtermRef}
                    className="ctm-terminal-xterm"
                    sessionKey={selectedTaskId}
                    onData={handleTerminalData}
                    onResize={handleTerminalResize}
                    readOnly={['completed', 'failed', 'stopped'].includes(selectedTask.status)}
                  />
                </div>
                {/* Stop button — typing now happens directly inside the terminal */}
                {(selectedTask.status === 'running' || selectedTask.status === 'queued' || selectedTask.status === 'loop') && (
                  <div className="ctm-terminal-actions">
                    <span className="ctm-terminal-hint">Click the terminal and type — keystrokes go straight to the PTY.</span>
                    <button
                      className="ctm-btn ctm-btn--danger ctm-btn--sm"
                      onClick={() => handleStopTask(selectedTask.id)}
                    >
                      <Square size={14} /> Stop
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="ctm-no-selection">
                <Terminal size={40} />
                <h3>Select a task to view output</h3>
                <p>Or create a new task to get started</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClaudeTaskManager;
