import React, { useState } from 'react';
import { Star, Filter, MoreHorizontal, Bot, Sparkles } from 'lucide-react';
import { Board } from '../../types';
import { useBoardStore } from '../../stores/boardStore';
import { useUIStore } from '../../stores/uiStore';
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
  const updateBoard = useBoardStore(s => s.updateBoard);
  const starBoard = useBoardStore(s => s.starBoard);
  const { toggleBoardMenu, filterLabels, clearFilters } = useUIStore();

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
    </div>
  );
};

export default BoardHeader;
