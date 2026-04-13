import React, { useState, useEffect } from 'react';
import { X, FolderOpen, Save, Cpu, RefreshCw, Loader2 } from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { listModels, type RunnerModel } from '../../services/claudeRunner';
import './settings.css';

interface SettingsProps {
  onClose: () => void;
}

const Settings: React.FC<SettingsProps> = ({ onClose }) => {
  const workingDir = useSettingsStore(s => s.workingDir);
  const setWorkingDir = useSettingsStore(s => s.setWorkingDir);
  const selectedModel = useSettingsStore(s => s.selectedModel);
  const setSelectedModel = useSettingsStore(s => s.setSelectedModel);

  const [dirValue, setDirValue] = useState(workingDir);
  const [dirSaved, setDirSaved] = useState(false);
  const [models, setModels] = useState<RunnerModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');

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
        </div>
      </div>
    </div>
  );
};

export default Settings;
