import { create } from 'zustand';

export interface AwaitingUserEntry {
  taskId: string;
  boardId: string | null;
  situation: string;
  question: string;
  at: number;
}

interface UIState {
  isSidebarOpen: boolean;
  activeCardId: string | null;
  activeBoardId: string | null;
  activeBoardMenuOpen: boolean;
  searchQuery: string;
  filterLabels: string[];
  filterMembers: string[];
  filterDueDate: string | null;
  // Claude Code Runner global state
  showClaudeRunner: boolean;
  runnerFocusTaskId: string | null;
  awaitingUserTasks: Record<string, AwaitingUserEntry>;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  openCard: (cardId: string) => void;
  closeCard: () => void;
  setActiveBoardId: (boardId: string | null) => void;
  toggleBoardMenu: () => void;
  closeBoardMenu: () => void;
  setSearchQuery: (query: string) => void;
  toggleFilterLabel: (labelId: string) => void;
  toggleFilterMember: (memberId: string) => void;
  setFilterDueDate: (filter: string | null) => void;
  clearFilters: () => void;
  setShowClaudeRunner: (open: boolean) => void;
  openRunnerForTask: (taskId: string) => void;
  setRunnerFocusTaskId: (taskId: string | null) => void;
  markAwaitingUser: (entry: AwaitingUserEntry) => void;
  clearAwaitingUser: (taskId: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isSidebarOpen: true,
  activeCardId: null,
  activeBoardId: null,
  activeBoardMenuOpen: false,
  searchQuery: '',
  filterLabels: [],
  filterMembers: [],
  filterDueDate: null,
  showClaudeRunner: false,
  runnerFocusTaskId: null,
  awaitingUserTasks: {},

  toggleSidebar: () => set(s => ({ isSidebarOpen: !s.isSidebarOpen })),
  setSidebarOpen: (open) => set({ isSidebarOpen: open }),
  openCard: (cardId) => set({ activeCardId: cardId }),
  closeCard: () => set({ activeCardId: null }),
  setActiveBoardId: (boardId) => set({ activeBoardId: boardId }),
  setShowClaudeRunner: (open) => set({ showClaudeRunner: open }),
  setRunnerFocusTaskId: (taskId) => set({ runnerFocusTaskId: taskId }),
  openRunnerForTask: (taskId) => set({ showClaudeRunner: true, runnerFocusTaskId: taskId }),
  markAwaitingUser: (entry) => set(s => ({
    awaitingUserTasks: { ...s.awaitingUserTasks, [entry.taskId]: entry },
  })),
  clearAwaitingUser: (taskId) => set(s => {
    const next = { ...s.awaitingUserTasks };
    delete next[taskId];
    return { awaitingUserTasks: next };
  }),
  toggleBoardMenu: () => set(s => ({ activeBoardMenuOpen: !s.activeBoardMenuOpen })),
  closeBoardMenu: () => set({ activeBoardMenuOpen: false }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  toggleFilterLabel: (labelId) => set(s => ({
    filterLabels: s.filterLabels.includes(labelId)
      ? s.filterLabels.filter(id => id !== labelId)
      : [...s.filterLabels, labelId],
  })),
  toggleFilterMember: (memberId) => set(s => ({
    filterMembers: s.filterMembers.includes(memberId)
      ? s.filterMembers.filter(id => id !== memberId)
      : [...s.filterMembers, memberId],
  })),
  setFilterDueDate: (filter) => set({ filterDueDate: filter }),
  clearFilters: () => set({ filterLabels: [], filterMembers: [], filterDueDate: null, searchQuery: '' }),
}));
