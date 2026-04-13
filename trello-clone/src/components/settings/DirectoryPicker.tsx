import React, { useEffect, useState, useCallback } from 'react';
import { X, Home, ArrowUp, FolderPlus, Folder, Check, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { listFsDirectory, fsMkdir, type FsListResult, type FsEntry } from '../../services/claudeRunner';
import './directory-picker.css';

interface DirectoryPickerProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

const DirectoryPicker: React.FC<DirectoryPickerProps> = ({ initialPath, onSelect, onClose }) => {
  const [data, setData] = useState<FsListResult | null>(null);
  const [manualPath, setManualPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);

  const load = useCallback(async (target?: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await listFsDirectory(target);
      setData(result);
      setManualPath(result.path);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(initialPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEntryClick = (entry: FsEntry) => {
    if (!data) return;
    const next = data.path.endsWith('/') ? data.path + entry.name : data.path + '/' + entry.name;
    load(next);
  };

  const handleParent = () => {
    if (data?.parent) load(data.parent);
  };

  const handleHome = () => {
    if (data?.home) load(data.home);
    else load();
  };

  const handleManualGo = () => {
    if (manualPath.trim()) load(manualPath.trim());
  };

  const handleCreateFolder = async () => {
    if (!data || !newFolderName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const target = data.path.endsWith('/')
        ? data.path + newFolderName.trim()
        : data.path + '/' + newFolderName.trim();
      const result = await fsMkdir(target);
      setShowNewFolder(false);
      setNewFolderName('');
      // Refresh current directory, then drill into the new folder
      await load(data.path);
      if (result.created) {
        // Drill in so the user can hit "Select" immediately
        setTimeout(() => load(result.path), 100);
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setCreating(false);
    }
  };

  const handleSelect = () => {
    if (data?.path) onSelect(data.path);
  };

  return (
    <div className="dirpick-backdrop" onClick={onClose}>
      <div className="dirpick-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dirpick-header">
          <div className="dirpick-title">
            <Folder size={16} />
            <span>Pick a working directory</span>
          </div>
          <button className="dirpick-close" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="dirpick-toolbar">
          <button className="dirpick-tool" onClick={handleParent} disabled={!data?.parent || loading} title="Parent">
            <ArrowUp size={14} />
          </button>
          <button className="dirpick-tool" onClick={handleHome} disabled={loading} title="Home">
            <Home size={14} />
          </button>
          <button className="dirpick-tool" onClick={() => data && load(data.path)} disabled={loading} title="Refresh">
            {loading ? <Loader2 size={14} className="dirpick-spin" /> : <RefreshCw size={14} />}
          </button>
          <input
            type="text"
            className="dirpick-path-input"
            placeholder="/absolute/path"
            value={manualPath}
            onChange={(e) => setManualPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleManualGo()}
          />
          <button className="dirpick-tool dirpick-tool--go" onClick={handleManualGo} disabled={loading}>
            Go
          </button>
        </div>

        {error && (
          <div className="dirpick-error">
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        <div className="dirpick-list">
          {loading && !data ? (
            <div className="dirpick-empty">
              <Loader2 size={16} className="dirpick-spin" />
              <span>Loading…</span>
            </div>
          ) : data && data.entries.length === 0 ? (
            <div className="dirpick-empty">
              <span>No subdirectories here.</span>
            </div>
          ) : (
            data?.entries.map((entry) => (
              <button
                key={entry.name}
                className="dirpick-row"
                onClick={() => handleEntryClick(entry)}
              >
                <Folder size={14} />
                <span>{entry.name}</span>
              </button>
            ))
          )}
        </div>

        {showNewFolder ? (
          <div className="dirpick-newfolder">
            <input
              type="text"
              placeholder="New folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              autoFocus
            />
            <button
              className="dirpick-btn dirpick-btn--primary"
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim() || creating}
            >
              {creating ? <Loader2 size={12} className="dirpick-spin" /> : <Check size={12} />}
              Create
            </button>
            <button className="dirpick-btn" onClick={() => { setShowNewFolder(false); setNewFolderName(''); }}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="dirpick-footer">
            <button
              className="dirpick-btn"
              onClick={() => setShowNewFolder(true)}
              disabled={!data || loading}
            >
              <FolderPlus size={13} />
              New folder here
            </button>
            <div className="dirpick-current">
              <span className="dirpick-current-label">Current:</span>
              <code title={data?.path}>{data?.path || '—'}</code>
            </div>
            <button className="dirpick-btn dirpick-btn--primary" onClick={handleSelect} disabled={!data || loading}>
              <Check size={13} />
              Select this folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default DirectoryPicker;
