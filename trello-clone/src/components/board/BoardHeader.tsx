import React, { useState, useEffect, useRef } from 'react';
import { Star, Filter, MoreHorizontal, Bot, Sparkles, ExternalLink, ChevronDown, FolderOpen, Terminal, Code, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Board } from '../../types';
import { useBoardStore } from '../../stores/boardStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { listOpenTargets, openProjectIn, type OpenTarget } from '../../services/claudeRunner';
import Avatar from '../common/Avatar';
import SkillsDialog from '../skills/SkillsDialog';
import './board.css';

interface BoardHeaderProps {
  board: Board;
  onOpenAssistant: () => void;
}

const BoardHeader: React.FC<BoardHeaderProps> = ({ board, onOpenAssistant }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(board.title);
  const [showFilter, setShowFilter] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [showOpenMenu, setShowOpenMenu] = useState(false);
  const [openTargets, setOpenTargets] = useState<OpenTarget[]>([]);
  const [openingTool, setOpeningTool] = useState<string | null>(null);
  const [openStatus, setOpenStatus] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null);
  const openMenuRef = useRef<HTMLDivElement>(null);
  const workingDir = useSettingsStore(s => s.workingDir);
  const updateBoard = useBoardStore(s => s.updateBoard);
  const starBoard = useBoardStore(s => s.starBoard);
  const { toggleBoardMenu, filterLabels, clearFilters } = useUIStore();

  // Lazy-load the editor list the first time the dropdown opens
  useEffect(() => {
    if (showOpenMenu && openTargets.length === 0) {
      listOpenTargets().then(setOpenTargets).catch(() => { /* leave empty */ });
    }
  }, [showOpenMenu, openTargets.length]);

  // Close the dropdown on outside click
  useEffect(() => {
    if (!showOpenMenu) return;
    const onClick = (e: MouseEvent) => {
      if (openMenuRef.current && !openMenuRef.current.contains(e.target as Node)) {
        setShowOpenMenu(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showOpenMenu]);

  // Auto-dismiss the success/error toast after a couple of seconds
  useEffect(() => {
    if (!openStatus) return;
    const t = setTimeout(() => setOpenStatus(null), 3000);
    return () => clearTimeout(t);
  }, [openStatus]);

  const handleOpenProject = async (toolId: string, label: string) => {
    if (!workingDir) {
      setOpenStatus({ kind: 'error', message: 'Set a Working Directory in Settings first.' });
      return;
    }
    setOpeningTool(toolId);
    setOpenStatus(null);
    try {
      await openProjectIn(toolId, workingDir);
      setOpenStatus({ kind: 'ok', message: `Opened in ${label}` });
      setShowOpenMenu(false);
    } catch (err) {
      setOpenStatus({ kind: 'error', message: String(err instanceof Error ? err.message : err) });
    } finally {
      setOpeningTool(null);
    }
  };

  const iconForTool = (id: string) => {
    if (id === 'finder') return <FolderOpen size={13} />;
    if (id === 'terminal' || id === 'iterm') return <Terminal size={13} />;
    return <Code size={13} />;
  };

  const handleSave = () => {
    if (editTitle.trim()) {
      updateBoard(board.id, { title: editTitle.trim() });
    } else {
      setEditTitle(board.title);
    }
    setIsEditing(false);
  };

  const activeFilters = filterLabels.length;

  return (
    <div className="board-header">
      <div className="board-header-left">
        {isEditing ? (
          <input
            type="text"
            className="board-title-input"
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            onBlur={handleSave}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            autoFocus
          />
        ) : (
          <button className="board-title" onClick={() => setIsEditing(true)}>
            {board.title}
          </button>
        )}
        <button
          className={`board-star-btn ${board.isStarred ? 'board-star-btn--active' : ''}`}
          onClick={() => starBoard(board.id)}
        >
          <Star size={16} fill={board.isStarred ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className="board-header-right">
        <div className="board-members">
          {board.members.map(m => (
            <Avatar key={m.id} name={m.name} color={m.color} size="sm" />
          ))}
        </div>
        <div style={{ position: 'relative' }}>
          <button className="board-header-btn" onClick={() => setShowFilter(!showFilter)}>
            <Filter size={16} />
            <span>Filter{activeFilters > 0 ? ` (${activeFilters})` : ''}</span>
          </button>
          {showFilter && (
            <div className="filter-dropdown" onClick={e => e.stopPropagation()}>
              <div className="filter-section">
                <div className="filter-section-title">Labels</div>
                {board.labels.map(label => (
                  <label key={label.id} className="filter-option">
                    <input
                      type="checkbox"
                      checked={filterLabels.includes(label.id)}
                      onChange={() => useUIStore.getState().toggleFilterLabel(label.id)}
                    />
                    <div className="filter-color-dot" style={{ backgroundColor: label.color }} />
                    <span>{label.name || 'Unnamed'}</span>
                  </label>
                ))}
              </div>
              {activeFilters > 0 && (
                <button className="filter-clear" onClick={clearFilters}>Clear filters</button>
              )}
            </div>
          )}
        </div>
        <div className="open-project-wrap" ref={openMenuRef}>
          <button
            className="board-header-btn"
            onClick={() => setShowOpenMenu(v => !v)}
            title={workingDir ? `Open ${workingDir} in…` : 'Set a working directory in Settings first'}
            disabled={!workingDir}
          >
            <ExternalLink size={16} />
            <span>Open</span>
            <ChevronDown size={12} />
          </button>
          {showOpenMenu && (
            <div className="open-project-menu">
              <div className="open-project-menu-header">
                <span>Open project in…</span>
                <code title={workingDir}>{workingDir || '(no working dir)'}</code>
              </div>
              {openTargets.length === 0 ? (
                <div className="open-project-empty">
                  <Loader2 size={12} className="open-project-spin" />
                  <span>Loading…</span>
                </div>
              ) : (
                openTargets.map(t => (
                  <button
                    key={t.id}
                    className="open-project-row"
                    onClick={() => handleOpenProject(t.id, t.label)}
                    disabled={openingTool !== null || !workingDir}
                  >
                    <span className="open-project-row-icon">{iconForTool(t.id)}</span>
                    <span className="open-project-row-label">{t.label}</span>
                    {openingTool === t.id && <Loader2 size={11} className="open-project-spin" />}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <button className="board-header-btn" onClick={() => setShowSkills(true)} title="Upload / pick / generate Claude Code skills into this project folder">
          <Sparkles size={16} />
          <span>Skills</span>
        </button>
        <button className="board-header-btn board-header-btn--ai" onClick={onOpenAssistant}>
          <Bot size={16} />
          <span>AI Assistant</span>
        </button>
        <button className="board-header-btn" onClick={toggleBoardMenu}>
          <MoreHorizontal size={16} />
        </button>
      </div>
      {showSkills && <SkillsDialog board={board} onClose={() => setShowSkills(false)} />}
      {openStatus && (
        <div className={`open-project-toast open-project-toast--${openStatus.kind}`}>
          {openStatus.kind === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          <span>{openStatus.message}</span>
        </div>
      )}
    </div>
  );
};

export default BoardHeader;
