import { useEffect, useRef } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { listRunnerTasks, getRunnerTask } from '../../services/claudeRunner';

/**
 * Background task: polls the Claude Code Runner every POLL_MS and, whenever
 * a task newly transitions into `awaiting_user`, fetches its details and
 * stores the question in uiStore. It also auto-opens the runner panel and
 * focuses that task so the user sees it immediately.
 *
 * Mounted once at App level so it runs regardless of which route is active.
 */
const POLL_MS = 5000;

const GlobalRunnerWatcher: React.FC = () => {
  const markAwaitingUser = useUIStore(s => s.markAwaitingUser);
  const clearAwaitingUser = useUIStore(s => s.clearAwaitingUser);
  const openRunnerForTask = useUIStore(s => s.openRunnerForTask);
  const awaitingUserTasks = useUIStore(s => s.awaitingUserTasks);
  // Avoid auto-opening the runner twice for the same transition.
  const seenRef = useRef<Set<string>>(new Set());
  // Remember the last status we saw per task so we can detect transitions
  // OUT of awaiting_user too (user resumed via terminal).
  const lastStatusRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let stopped = false;

    async function poll() {
      try {
        const tasks = await listRunnerTasks();
        const seen = seenRef.current;
        const lastStatus = lastStatusRef.current;
        const store = useUIStore.getState();

        for (const t of tasks) {
          const prev = lastStatus[t.id];
          lastStatus[t.id] = t.status;

          if (t.status === 'awaiting_user') {
            // Only fire on a transition, not every poll.
            if (prev === 'awaiting_user' || store.awaitingUserTasks[t.id]) continue;
            try {
              const full = await getRunnerTask(t.id);
              const entry = {
                taskId: t.id,
                boardId: (full as unknown as { boardId?: string | null }).boardId || null,
                situation: full.awaitingSituation || 'Claude is waiting for your input',
                question: full.awaitingQuestion || full.awaitingSituation || 'Claude Code is waiting for a decision.',
                at: Date.now(),
              };
              markAwaitingUser(entry);
              if (!seen.has(t.id)) {
                seen.add(t.id);
                openRunnerForTask(t.id);
              }
            } catch (err) {
              console.warn('[GlobalRunnerWatcher] getRunnerTask failed:', err);
            }
          } else if (prev === 'awaiting_user' && t.status !== 'awaiting_user') {
            // Task resumed — either user answered or it was stopped.
            clearAwaitingUser(t.id);
            seen.delete(t.id);
          }
        }
        // GC entries for tasks that no longer exist
        for (const id of Object.keys(store.awaitingUserTasks)) {
          if (!tasks.find(t => t.id === id)) {
            clearAwaitingUser(id);
            seen.delete(id);
          }
        }
      } catch {
        // runner unreachable — ignore, retry next tick
      }
    }

    // Initial + interval
    poll();
    const interval = setInterval(() => { if (!stopped) poll(); }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // This component is headless — it only runs the polling side effect.
  void awaitingUserTasks;
  return null;
};

export default GlobalRunnerWatcher;
