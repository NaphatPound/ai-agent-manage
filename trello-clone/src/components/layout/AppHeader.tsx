import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LayoutGrid, Plus, Search, Bell, X, Terminal, Settings as SettingsIcon } from 'lucide-react';
import { useBoardStore } from '../../stores/boardStore';
import { useUIStore } from '../../stores/uiStore';
import Avatar from '../common/Avatar';
import CreateBoard from '../workspace/CreateBoard';
import ClaudeTaskManager from '../claude/ClaudeTaskManager';
import Settings from '../settings/Settings';
import './header.css';

const AppHeader: React.FC = () => {
  const [showCreate, setShowCreate] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [searchText, setSearchText] = useState('');
  const location = useLocation();
  const boards = useBoardStore(s => s.boards);
  const { setSearchQuery } = useUIStore();
  const showTaskManager = useUIStore(s => s.showClaudeRunner);
  const setShowTaskManager = useUIStore(s => s.setShowClaudeRunner);
  const isBoardPage = location.pathname.startsWith('/board/');

  const handleSearch = (val: string) => {
    setSearchText(val);
    setSearchQuery(val);
  };

  return (
    <>
      <header className={`app-header ${isBoardPage ? 'app-header--transparent' : ''}`}>
        <div className="header-left">
          <Link to="/" className="header-logo">
            <LayoutGrid size={20} />
            <span className="header-logo-text">Trello</span>
          </Link>
          <button className="header-btn header-btn--create" onClick={() => setShowCreate(true)}>
            <Plus size={16} />
            <span>Create</span>
          </button>
        </div>
        <div className="header-right">
          <div className={`header-search ${showSearch ? 'header-search--active' : ''}`}>
            <Search size={16} />
            <input
              type="text"
              placeholder="Search..."
              value={searchText}
              onChange={e => handleSearch(e.target.value)}
              onFocus={() => setShowSearch(true)}
              onBlur={() => { if (!searchText) setShowSearch(false); }}
            />
            {searchText && (
              <button onClick={() => { handleSearch(''); setShowSearch(false); }}>
                <X size={14} />
              </button>
            )}
          </div>
          <button
            className="header-btn header-btn--claude"
            onClick={() => setShowTaskManager(true)}
            title="Claude Code Runner"
          >
            <Terminal size={16} />
            <span>Runner</span>
          </button>
          <button
            className="header-btn header-icon-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <SettingsIcon size={18} />
          </button>
          <button className="header-btn header-icon-btn" title="Notifications">
            <Bell size={18} />
          </button>
          <Avatar name="You" color="#0079BF" size="sm" />
        </div>
      </header>
      {showCreate && <CreateBoard onClose={() => setShowCreate(false)} />}
      {showTaskManager && <ClaudeTaskManager onClose={() => setShowTaskManager(false)} />}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </>
  );
};

export default AppHeader;
