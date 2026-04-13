import React, { useState, useEffect } from 'react';
import { X, FolderOpen, Save, Cpu, RefreshCw, Loader2, Zap, Plus, Trash2 } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useBoardStore } from '../../stores/boardStore';
import { useUIStore } from '../../stores/uiStore';
import { listModels, type RunnerModel } from '../../services/claudeRunner';
import { Shortcut } from '../../types';
import { newShortcut } from '../../lib/shortcuts';
import './settings.css';

interface SettingsProps {
  onClose: () => void;
}

const Settings: React.FC<SettingsProps> = ({ onClose }) => {
  const workingDir = useSettingsStore(s => s.workingDir);
  const setWorkingDir = useSettingsStore(s => s.setWorkingDir);
  const selectedModel = useSettingsStore(s => s.selectedModel);
  const setSelectedModel = useSettingsStore(s => s.setSelectedModel);
  const globalShortcuts = useSettingsStore(s => s.globalShortcuts);
  const addGlobalShortcut = useSettingsStore(s => s.addGlobalShortcut);
  const updateGlobalShortcut = useSettingsStore(s => s.updateGlobalShortcut);
  const removeGlobalShortcut = useSettingsStore(s => s.removeGlobalShortcut);

  const activeBoardId = useUIStore(s => s.activeBoardId);
  const activeBoard = useBoardStore(s => (activeBoardId ? s.boards[activeBoardId] : undefined));
  const updateBoard = useBoardStore(s => s.updateBoard);

  const [dirValue, setDirValue] = useState(workingDir);
  const [dirSaved, setDirSaved] = useState(false);
  const [models, setModels] = useState<RunnerModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');

  // Shortcut CRUD helpers — global + board-scoped
  const boardShortcuts = activeBoard?.shortcuts ?? [];
  const addBoardShortcut = (shortcut: Shortcut) => {
    if (!activeBoard) return;
    updateBoard(activeBoard.id, { shortcuts: [...boardShortcuts, shortcut] });
  };
  const updateBoardShortcut = (id: string, patch: Partial<Shortcut>) => {
    if (!activeBoard) return;
    updateBoard(activeBoard.id, {
      shortcuts: boardShortcuts.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  };
  const removeBoardShortcut = (id: string) => {
    if (!activeBoard) return;
    updateBoard(activeBoard.id, { shortcuts: boardShortcuts.filter((s) => s.id !== id) });
  };

  const fetchModels = async () => {
    setModelsLoading(true);
    setModelsError('');
    try {
      const data = await listModels();
      setModels(data);
    } catch (e) {
      setModelsError(`Cannot load models: ${String(e)}`);
    } finally {
      setModelsLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const handleSaveDir = () => {
    setWorkingDir(dirValue.trim());
    setDirSaved(true);
    setTimeout(() => setDirSaved(false), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveDir();
  };

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2 className="settings-title">Settings</h2>
          <button className="settings-close" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-section">
            <h3 className="settings-section-title">Claude Code Runner</h3>

            {/* Working Directory */}
            <label className="settings-label">
              <FolderOpen size={14} />
              <span>Project Working Directory</span>
            </label>
            <p className="settings-hint">
              The folder path sent to Claude Code Runner when executing tasks.
            </p>
            <div className="settings-input-row">
              <input
                type="text"
                className="settings-input"
                placeholder="/path/to/your/project"
                value={dirValue}
                onChange={e => setDirValue(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button
                className="settings-save-btn"
                onClick={handleSaveDir}
                disabled={dirValue.trim() === workingDir}
              >
                <Save size={14} />
                {dirSaved ? 'Saved!' : 'Save'}
              </button>
            </div>
            {workingDir && (
              <p className="settings-current">
                Current: <code>{workingDir}</code>
              </p>
            )}
          </div>

          {/* AI Model */}
          <div className="settings-section">
            <label className="settings-label">
              <Cpu size={14} />
              <span>AI Model</span>
              <button
                className="settings-refresh-btn"
                onClick={fetchModels}
                disabled={modelsLoading}
                title="Refresh models"
              >
                {modelsLoading ? <Loader2 size={12} className="settings-spin" /> : <RefreshCw size={12} />}
              </button>
            </label>
            <p className="settings-hint">
              Select the AI model used by Claude Code Runner. Leave as "Default" to use the runner's default model.
            </p>
            {modelsError ? (
              <p className="settings-error">{modelsError}</p>
            ) : (
              <select
                className="settings-select"
                value={selectedModel}
                onChange={e => setSelectedModel(e.target.value)}
                disabled={modelsLoading}
              >
                <option value="">Default (runner's default)</option>
                {(() => {
                  const grouped = new Map<string, RunnerModel[]>();
                  for (const m of models) {
                    const key = m.group || 'Other';
                    if (!grouped.has(key)) grouped.set(key, []);
                    grouped.get(key)!.push(m);
                  }
                  // Render ungrouped as flat options, grouped entries as <optgroup>
                  if (grouped.size === 1 && grouped.has('Other')) {
                    return models.map(m => (
                      <option key={m.id} value={m.id}>{m.name || m.id}</option>
                    ));
                  }
                  return Array.from(grouped.entries()).map(([group, items]) => (
                    <optgroup key={group} label={group}>
                      {items.map(m => (
                        <option key={m.id} value={m.id}>{m.name || m.id}</option>
                      ))}
                    </optgroup>
                  ));
                })()}
              </select>
            )}
            {selectedModel && (
              <p className="settings-current">
                Selected: <code>{selectedModel}</code>
              </p>
            )}
          </div>

          {/* Global Shortcuts */}
          <div className="settings-section">
            <label className="settings-label">
              <Zap size={14} />
              <span>Global Shortcuts</span>
              <button
                className="settings-refresh-btn"
                onClick={() => addGlobalShortcut(newShortcut())}
                title="Add shortcut"
                style={{ marginLeft: 'auto' }}
              >
                <Plus size={12} />
              </button>
            </label>
            <p className="settings-hint">
              Reusable commands that ship straight to Claude Code Runner (a tracking card is still created). These apply to every board.
            </p>
            <ShortcutList
              shortcuts={globalShortcuts}
              models={models}
              onUpdate={updateGlobalShortcut}
              onRemove={removeGlobalShortcut}
              placeholder="No global shortcuts yet — click + to add one."
            />
          </div>

          {/* Board Shortcuts — only when a board is currently open */}
          {activeBoard && (
            <div className="settings-section">
              <label className="settings-label">
                <Zap size={14} />
                <span>Board Shortcuts — {activeBoard.title}</span>
                <button
                  className="settings-refresh-btn"
                  onClick={() => addBoardShortcut(newShortcut())}
                  title="Add shortcut"
                  style={{ marginLeft: 'auto' }}
                >
                  <Plus size={12} />
                </button>
              </label>
              <p className="settings-hint">
                Shortcuts that only appear on this board. These stack on top of global shortcuts; a board entry with the same id wins.
              </p>
              <ShortcutList
                shortcuts={boardShortcuts}
                models={models}
                onUpdate={updateBoardShortcut}
                onRemove={removeBoardShortcut}
                placeholder="No board-specific shortcuts yet — click + to add one."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Shortcut editor list ───────────────────────────────────────────────────
interface ShortcutListProps {
  shortcuts: Shortcut[];
  models: RunnerModel[];
  onUpdate: (id: string, patch: Partial<Shortcut>) => void;
  onRemove: (id: string) => void;
  placeholder: string;
}

const ShortcutList: React.FC<ShortcutListProps> = ({ shortcuts, models, onUpdate, onRemove, placeholder }) => {
  if (shortcuts.length === 0) {
    return <p className="settings-hint" style={{ opacity: 0.6 }}>{placeholder}</p>;
  }
  return (
    <div className="shortcut-list">
      {shortcuts.map((s) => (
        <div key={s.id} className="shortcut-row">
          <div className="shortcut-row-header">
            <input
              type="text"
              className="settings-input shortcut-name"
              placeholder="Shortcut name (e.g. Run tests)"
              value={s.name}
              onChange={(e) => onUpdate(s.id, { name: e.target.value })}
            />
            <input
              type="text"
              className="settings-input shortcut-icon"
              placeholder="🔧"
              value={s.icon || ''}
              onChange={(e) => onUpdate(s.id, { icon: e.target.value })}
              maxLength={4}
            />
            <button
              className="shortcut-remove"
              onClick={() => onRemove(s.id)}
              title="Remove shortcut"
            >
              <Trash2 size={12} />
            </button>
          </div>
          <textarea
            className="settings-input shortcut-prompt"
            placeholder="The prompt sent to Claude Code Runner when this shortcut is clicked."
            value={s.prompt}
            onChange={(e) => onUpdate(s.id, { prompt: e.target.value })}
            rows={3}
          />
          <div className="shortcut-row-footer">
            <select
              className="settings-select shortcut-model"
              value={s.model || ''}
              onChange={(e) => onUpdate(s.id, { model: e.target.value || undefined })}
              title="Model override (blank = use current board/global default)"
            >
              <option value="">Model: default</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name || m.id}</option>
              ))}
            </select>
            <select
              className="settings-select shortcut-mode"
              value={s.mode || 'one-time'}
              onChange={(e) => onUpdate(s.id, { mode: e.target.value as 'one-time' | 'loop' })}
              title="one-time: exit Claude session after the task finishes. loop: keep the Claude session alive after idle so follow-ups can be sent."
            >
              <option value="one-time">Mode: one-time</option>
              <option value="loop">Mode: loop</option>
            </select>
            <input
              type="text"
              className="settings-input shortcut-workingdir"
              placeholder="Working dir override (optional)"
              value={s.workingDir || ''}
              onChange={(e) => onUpdate(s.id, { workingDir: e.target.value || undefined })}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default Settings;
