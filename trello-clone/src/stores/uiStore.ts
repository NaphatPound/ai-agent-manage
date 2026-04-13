import { create } from 'zustand';

interface UIState {
  isSidebarOpen: boolean;
  activeCardId: string | null;
  activeBoardId: string | null;
  activeBoardMenuOpen: boolean;
  searchQuery: string;
  filterLabels: string[];
  filterMembers: string[];
  filterDueDate: string | null;

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

  toggleSidebar: () => set(s => ({ isSidebarOpen: !s.isSidebarOpen })),
  setSidebarOpen: (open) => set({ isSidebarOpen: open }),
  openCard: (cardId) => set({ activeCardId: cardId }),
  closeCard: () => set({ activeCardId: null }),
  setActiveBoardId: (boardId) => set({ activeBoardId: boardId }),
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
