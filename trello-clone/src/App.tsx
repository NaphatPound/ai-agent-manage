import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import AppHeader from './components/layout/AppHeader';
import Sidebar from './components/layout/Sidebar';
import HomePage from './pages/HomePage';
import BoardPage from './pages/BoardPage';
import NotFoundPage from './pages/NotFoundPage';
import CreateBoard from './components/workspace/CreateBoard';
import GlobalRunnerWatcher from './components/claude/GlobalRunnerWatcher';
import AwaitingUserToast from './components/claude/AwaitingUserToast';
import { useBoardStore } from './stores/boardStore';
import { useUIStore } from './stores/uiStore';
import './styles/animations.css';

function AppContent() {
  const [showCreate, setShowCreate] = useState(false);
  const location = useLocation();
  const { isSidebarOpen } = useUIStore();
  const loadFromStorage = useBoardStore(s => s.loadFromStorage);
  const isBoardPage = location.pathname.startsWith('/board/');

  useEffect(() => {
    loadFromStorage();
  }, []);

  return (
    <div className="app">
      <AppHeader />
      <div className="app-body">
        {!isBoardPage && <Sidebar onCreateBoard={() => setShowCreate(true)} />}
        <main
          className="app-main"
          style={{
            marginLeft: !isBoardPage && isSidebarOpen ? 'var(--sidebar-width)' : 0,
            marginTop: 'var(--header-height)',
            height: 'calc(100vh - var(--header-height))',
            overflow: isBoardPage ? 'hidden' : 'auto',
            transition: 'margin-left 300ms ease',
          }}
        >
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/board/:boardId" element={<BoardPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
      </div>
      {showCreate && <CreateBoard onClose={() => setShowCreate(false)} />}
      <GlobalRunnerWatcher />
      <AwaitingUserToast />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
