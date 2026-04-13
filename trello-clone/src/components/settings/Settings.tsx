import React, { useState, useEffect } from 'react';
import { X, FolderOpen, Save, Cpu, RefreshCw, Loader2, Zap, Plus, Trash2, FolderPlus, Folder, ClipboardList, Sparkles } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useBoardStore } from '../../stores/boardStore';
import { useUIStore } from '../../stores/uiStore';
import { listModels, fsExists, fsMkdir, type RunnerModel } from '../../services/claudeRunner';
import { generateTaskTemplate } from '../../services/ai';
import { Shortcut, TaskTemplate } from '../../types';
import { newShortcut } from '../../lib/shortcuts';
import { newTaskTemplate } from '../../lib/taskTemplates';
import DirectoryPicker from './DirectoryPicker';
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
  const globalTaskTemplates = useSettingsStore(s => s.globalTaskTemplates);
  const addGlobalTaskTemplate = useSettingsStore(s => s.addGlobalTaskTemplate);
  const updateGlobalTaskTemplate = useSettingsStore(s => s.updateGlobalTaskTemplate);
  const removeGlobalTaskTemplate = useSettingsStore(s => s.removeGlobalTaskTemplate);

  const activeBoardId = useUIStore(s => s.activeBoardId);
  const activeBoard = useBoardStore(s => (activeBoardId ? s.boards[activeBoardId] : undefined));
  const updateBoard = useBoardStore(s => s.updateBoard);

  const [dirValue, setDirValue] = useState(workingDir);
  const [dirSaved, setDirSaved] = useState(false);
  const [dirCheckState, setDirCheckState] = useState<'idle' | 'checking' | 'missing' | 'creating' | 'error'>('idle');
  const [dirCheckError, setDirCheckError] = useState('');
  const [showPicker, setShowPicker] = useState(false);
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

  // Task template CRUD helpers — global + board-scoped
  const boardTaskTemplates = activeBoard?.taskTemplates ?? [];
  const addBoardTaskTemplate = (template: TaskTemplate) => {
    if (!activeBoard) return;
    updateBoard(activeBoard.id, { taskTemplates: [...boardTaskTemplates, template] });
  };
  const updateBoardTaskTemplate = (id: string, patch: Partial<TaskTemplate>) => {
    if (!activeBoard) return;
    updateBoard(activeBoard.id, {
      taskTemplates: boardTaskTemplates.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  };
  const removeBoardTaskTemplate = (id: string) => {
    if (!activeBoard) return;
    updateBoard(activeBoard.id, { taskTemplates: boardTaskTemplates.filter((t) => t.id !== id) });
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

  const persistDir = (path: string) => {
    setWorkingDir(path);
    setDirValue(path);
    setDirSaved(true);
    setDirCheckState('idle');
    setDirCheckError('');
    setTimeout(() => setDirSaved(false), 2000);
  };

  const handleSaveDir = async () => {
    const trimmed = dirValue.trim();
    if (!trimmed) return;
    setDirCheckState('checking');
    setDirCheckError('');
    try {
      const result = await fsExists(trimmed);
      if (result.exists && result.isDir) {
        persistDir(result.path);
      } else if (result.exists && !result.isDir) {
        setDirCheckState('error');
        setDirCheckError('That path exists but is a file, not a folder.');
      } else {
        setDirCheckState('missing');
      }
    } catch (err) {
      setDirCheckState('error');
      setDirCheckError(String(err instanceof Error ? err.message : err));
    }
  };

  const handleCreateMissingDir = async () => {
    const trimmed = dirValue.trim();
    if (!trimmed) return;
    setDirCheckState('creating');
    setDirCheckError('');
    try {
      const result = await fsMkdir(trimmed);
      persistDir(result.path);
    } catch (err) {
      setDirCheckState('error');
      setDirCheckError(String(err instanceof Error ? err.message : err));
    }
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
                onChange={e => { setDirValue(e.target.value); setDirCheckState('idle'); }}
                onKeyDown={handleKeyDown}
              />
              <button
                className="settings-save-btn settings-save-btn--secondary"
                onClick={() => setShowPicker(true)}
                title="Browse folders on this Mac"
              >
                <Folder size={14} />
                Browse
              </button>
              <button
                className="settings-save-btn"
                onClick={handleSaveDir}
                disabled={!dirValue.trim() || dirCheckState === 'checking' || dirCheckState === 'creating'}
              >
                {dirCheckState === 'checking' ? <Loader2 size={14} className="settings-spin" /> : <Save size={14} />}
                {dirSaved ? 'Saved!' : 'Save'}
              </button>
            </div>
            {dirCheckState === 'missing' && (
              <div className="settings-dir-missing">
                <span>
                  Folder <code>{dirValue.trim()}</code> doesn't exist yet.
                </span>
                <button
                  className="settings-save-btn settings-save-btn--accent"
                  onClick={handleCreateMissingDir}
                  disabled={false}
                >
                  <FolderPlus size={13} />
                  Create it
                </button>
              </div>
            )}
            {dirCheckState === 'creating' && (
              <p className="settings-hint">
                <Loader2 size={12} className="settings-spin" /> Creating folder…
              </p>
            )}
            {dirCheckState === 'error' && dirCheckError && (
              <p className="settings-error">{dirCheckError}</p>
            )}
            {workingDir && dirCheckState !== 'missing' && dirCheckState !== 'error' && (
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

          {/* Global Task Templates */}
          <div className="settings-section">
            <label className="settings-label">
              <ClipboardList size={14} />
              <span>Global Task Templates</span>
              <button
                className="settings-refresh-btn"
                onClick={() => addGlobalTaskTemplate(newTaskTemplate())}
                title="Add template"
                style={{ marginLeft: 'auto' }}
              >
                <Plus size={12} />
              </button>
            </label>
            <p className="settings-hint">
              Reusable task-card blueprints. Open the AI Assistant's <strong>Template</strong> tab on any board to pick one (or many) and spawn cards in one click.
            </p>
            <TaskTemplateList
              templates={globalTaskTemplates}
              onAdd={addGlobalTaskTemplate}
              onUpdate={updateGlobalTaskTemplate}
              onRemove={removeGlobalTaskTemplate}
              placeholder="No global templates yet — click + to add one or use AI Generate below."
            />
          </div>

          {/* Board Task Templates — only when a board is currently open */}
          {activeBoard && (
            <div className="settings-section">
              <label className="settings-label">
                <ClipboardList size={14} />
                <span>Board Task Templates — {activeBoard.title}</span>
                <button
                  className="settings-refresh-btn"
                  onClick={() => addBoardTaskTemplate(newTaskTemplate())}
                  title="Add template"
                  style={{ marginLeft: 'auto' }}
                >
                  <Plus size={12} />
                </button>
              </label>
              <p className="settings-hint">
                Templates that only appear on this board. Same merge rule as shortcuts — board wins on id collision.
              </p>
              <TaskTemplateList
                templates={boardTaskTemplates}
                onAdd={addBoardTaskTemplate}
                onUpdate={updateBoardTaskTemplate}
                onRemove={removeBoardTaskTemplate}
                placeholder="No board-specific templates yet — click + to add one."
              />
            </div>
          )}
        </div>
      </div>
      {showPicker && (
        <DirectoryPicker
          initialPath={dirValue || workingDir || undefined}
          onSelect={(p) => {
            setDirValue(p);
            setWorkingDir(p);
            setDirCheckState('idle');
            setDirCheckError('');
            setDirSaved(true);
            setTimeout(() => setDirSaved(false), 2000);
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
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

// ─── Task template editor list ──────────────────────────────────────────────
interface TaskTemplateListProps {
  templates: TaskTemplate[];
  onAdd: (template: TaskTemplate) => void;
  onUpdate: (id: string, patch: Partial<TaskTemplate>) => void;
  onRemove: (id: string) => void;
  placeholder: string;
}

const TaskTemplateList: React.FC<TaskTemplateListProps> = ({ templates, onAdd, onUpdate, onRemove, placeholder }) => {
  const [genPrompt, setGenPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [showGen, setShowGen] = useState(false);

  const handleGenerate = async () => {
    if (!genPrompt.trim()) return;
    setGenerating(true);
    setGenError('');
    try {
      const draft = await generateTaskTemplate(genPrompt.trim());
      const fresh = newTaskTemplate();
      onAdd({
        ...fresh,
        name: draft.name,
        icon: draft.icon,
        cardTitle: draft.cardTitle,
        description: draft.description,
        checklist: draft.checklist,
        priority: draft.priority,
      });
      setGenPrompt('');
      setShowGen(false);
    } catch (err) {
      setGenError(String(err instanceof Error ? err.message : err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="tt-list">
      {templates.length === 0 ? (
        <p className="settings-hint" style={{ opacity: 0.6 }}>{placeholder}</p>
      ) : (
        templates.map((t) => (
          <div key={t.id} className="tt-row">
            <div className="tt-row-header">
              <input
                type="text"
                className="settings-input tt-name"
                placeholder="Template name (e.g. Bug triage)"
                value={t.name}
                onChange={(e) => onUpdate(t.id, { name: e.target.value })}
              />
              <input
                type="text"
                className="settings-input tt-icon"
                placeholder="📋"
                value={t.icon || ''}
                onChange={(e) => onUpdate(t.id, { icon: e.target.value })}
                maxLength={4}
              />
              <select
                className="settings-select tt-priority"
                value={t.priority || ''}
                onChange={(e) => onUpdate(t.id, { priority: (e.target.value || undefined) as TaskTemplate['priority'] })}
              >
                <option value="">Priority: —</option>
                <option value="critical">critical</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
              <button
                className="shortcut-remove"
                onClick={() => onRemove(t.id)}
                title="Remove template"
              >
                <Trash2 size={12} />
              </button>
            </div>
            <input
              type="text"
              className="settings-input tt-cardtitle"
              placeholder="Default card title"
              value={t.cardTitle}
              onChange={(e) => onUpdate(t.id, { cardTitle: e.target.value })}
            />
            <textarea
              className="settings-input tt-description"
              placeholder="Description (markdown). Explain how to do this task and include an example."
              value={t.description}
              onChange={(e) => onUpdate(t.id, { description: e.target.value })}
              rows={5}
            />
            <textarea
              className="settings-input tt-checklist"
              placeholder="Checklist items — one per line"
              value={(t.checklist || []).join('\n')}
              onChange={(e) => onUpdate(t.id, { checklist: e.target.value.split('\n').map((s) => s).filter((s) => s.trim().length > 0 || s === '') })}
              rows={4}
            />
          </div>
        ))
      )}

      {/* AI generate sub-form */}
      {showGen ? (
        <div className="tt-gen-box">
          <label className="settings-label">
            <Sparkles size={12} />
            <span>Describe the template for the AI</span>
          </label>
          <textarea
            className="settings-input tt-description"
            rows={3}
            placeholder="e.g. A template for debugging a flaky test — include how to reproduce, isolate, and fix."
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.target.value)}
          />
          {genError && <p className="settings-error">{genError}</p>}
          <div className="tt-gen-actions">
            <button
              className="settings-save-btn settings-save-btn--accent"
              onClick={handleGenerate}
              disabled={!genPrompt.trim() || generating}
            >
              {generating ? <Loader2 size={12} className="settings-spin" /> : <Sparkles size={12} />}
              Generate
            </button>
            <button
              className="settings-save-btn settings-save-btn--secondary"
              onClick={() => { setShowGen(false); setGenError(''); setGenPrompt(''); }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          className="settings-save-btn settings-save-btn--accent tt-gen-toggle"
          onClick={() => setShowGen(true)}
        >
          <Sparkles size={12} />
          AI Generate template
        </button>
      )}
    </div>
  );
};

export default Settings;
