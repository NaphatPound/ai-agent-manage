import { create } from 'zustand';
import { Shortcut } from '../types';

const STORAGE_KEY = 'trello-settings';

interface PersistedSettings {
  workingDir: string;
  selectedModel: string;
  globalShortcuts: Shortcut[];
}

interface SettingsState extends PersistedSettings {
  setWorkingDir: (dir: string) => void;
  setSelectedModel: (model: string) => void;
  addGlobalShortcut: (shortcut: Shortcut) => void;
  updateGlobalShortcut: (id: string, patch: Partial<Shortcut>) => void;
  removeGlobalShortcut: (id: string) => void;
}

function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        workingDir: parsed.workingDir ?? (import.meta.env.VITE_CLAUDE_RUNNER_WORKING_DIR || ''),
        selectedModel: parsed.selectedModel ?? '',
        globalShortcuts: Array.isArray(parsed.globalShortcuts) ? parsed.globalShortcuts : [],
      };
    }
  } catch { /* ignore */ }
  return {
    workingDir: import.meta.env.VITE_CLAUDE_RUNNER_WORKING_DIR || '',
    selectedModel: '',
    globalShortcuts: [],
  };
}

function saveSettings(state: PersistedSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...loadSettings(),

  setWorkingDir: (dir) => {
    set({ workingDir: dir });
    saveSettings({ ...get(), workingDir: dir });
  },

  setSelectedModel: (model) => {
    set({ selectedModel: model });
    saveSettings({ ...get(), selectedModel: model });
  },

  addGlobalShortcut: (shortcut) => {
    const next = [...get().globalShortcuts, shortcut];
    set({ globalShortcuts: next });
    saveSettings({ ...get(), globalShortcuts: next });
  },

  updateGlobalShortcut: (id, patch) => {
    const next = get().globalShortcuts.map((s) => (s.id === id ? { ...s, ...patch } : s));
    set({ globalShortcuts: next });
    saveSettings({ ...get(), globalShortcuts: next });
  },

  removeGlobalShortcut: (id) => {
    const next = get().globalShortcuts.filter((s) => s.id !== id);
    set({ globalShortcuts: next });
    saveSettings({ ...get(), globalShortcuts: next });
  },
}));
