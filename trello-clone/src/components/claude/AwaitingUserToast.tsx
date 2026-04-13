import React from 'react';
import { AlertTriangle, Terminal, X } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import './awaiting-user-toast.css';

/**
 * Sticky toast shown whenever one or more Claude Code Runner tasks are
 * waiting for a human reply. Clicking the "Answer" button opens the
 * runner panel and focuses that task so the user can type into the
 * live xterm directly.
 */
const AwaitingUserToast: React.FC = () => {
  const awaitingUserTasks = useUIStore(s => s.awaitingUserTasks);
  const openRunnerForTask = useUIStore(s => s.openRunnerForTask);
  const clearAwaitingUser = useUIStore(s => s.clearAwaitingUser);

  const entries = Object.values(awaitingUserTasks).sort((a, b) => b.at - a.at);
  if (entries.length === 0) return null;

  return (
    <div className="awaiting-toast-stack">
      {entries.map(entry => (
        <div key={entry.taskId} className="awaiting-toast">
          <div className="awaiting-toast-icon">
            <AlertTriangle size={16} />
          </div>
          <div className="awaiting-toast-body">
            <div className="awaiting-toast-title">Claude Code is waiting for you</div>
            <div className="awaiting-toast-question">{entry.question}</div>
            <div className="awaiting-toast-meta">
              Task <code>{entry.taskId.slice(0, 8)}…</code>
              {entry.boardId && <span> · board {entry.boardId.slice(0, 8)}…</span>}
            </div>
          </div>
          <div className="awaiting-toast-actions">
            <button
              className="awaiting-toast-btn awaiting-toast-btn--primary"
              onClick={() => openRunnerForTask(entry.taskId)}
            >
              <Terminal size={13} />
              <span>Answer</span>
            </button>
            <button
              className="awaiting-toast-btn awaiting-toast-btn--dismiss"
              title="Dismiss"
              onClick={() => clearAwaitingUser(entry.taskId)}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default AwaitingUserToast;
