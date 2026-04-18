import { create } from 'zustand';
import { Project } from '@/types';
import { STORAGE_KEYS, setStorage, removeStorage } from './storage';

// ── Auth Store ──────────────────────────────────────────────────────────────

interface AuthState {
  token: string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem(STORAGE_KEYS.token),

  setToken: (token) => {
    setStorage(STORAGE_KEYS.token, token);
    set({ token });
  },

  clearToken: () => {
    removeStorage(STORAGE_KEYS.token);
    set({ token: null });
  },
}));

// Non-hook accessors for use outside React (e.g., api.ts request function)
export const getTokenFromStore = () => useAuthStore.getState().token;
export const setTokenFromStore = (t: string) => useAuthStore.getState().setToken(t);
export const clearTokenFromStore = () => useAuthStore.getState().clearToken();

// ── Project Store ───────────────────────────────────────────────────────────

interface ProjectState {
  projects: Project[];
  loading: boolean;
  error: string | null;
  hasFetched: boolean;

  fetchProjects: () => Promise<void>;
  addProject: (project: Project) => void;
  updateProject: (project: Project) => void;
  removeProject: (id: string) => void;
  setProjects: (projects: Project[]) => void;
}

// Lazy import to avoid circular dependency (api.ts imports stores indirectly)
let _getProjects: (() => Promise<Project[]>) | null = null;
async function lazyGetProjects(): Promise<Project[]> {
  if (!_getProjects) {
    const api = await import('./api');
    _getProjects = api.getProjects;
  }
  return _getProjects();
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loading: false,
  error: null,
  hasFetched: false,

  fetchProjects: async () => {
    // Avoid redundant fetches
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const data = await lazyGetProjects();
      set({ projects: data, hasFetched: true });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load projects' });
    } finally {
      set({ loading: false });
    }
  },

  addProject: (project) =>
    set((s) => ({ projects: [...s.projects, project] })),

  updateProject: (project) =>
    set((s) => ({
      projects: s.projects.map((p) => (p.id === project.id ? project : p)),
    })),

  removeProject: (id) =>
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),

  setProjects: (projects) => set({ projects }),
}));

// ── Project Dialog Store ────────────────────────────────────────────────────
// In-memory store: persists across ProjectPage unmount/remount within the session.
// Keyed by projectId so each project maintains its own dialog state.

interface ProjectDialogEntry {
  filePreviewPath: string | null;
  shortcutEditorOpen: boolean;
  shortcutEditingId: string | null; // null = creating new
  shareHubOpen: boolean;
  shareHubLabel: string;
  shareHubCommand: string;
}

const DEFAULT_DIALOG_ENTRY: ProjectDialogEntry = {
  filePreviewPath: null,
  shortcutEditorOpen: false,
  shortcutEditingId: null,
  shareHubOpen: false,
  shareHubLabel: '',
  shareHubCommand: '',
};

interface ProjectDialogStore {
  entries: Record<string, ProjectDialogEntry>;
  get: (projectId: string) => ProjectDialogEntry;
  setFilePreviewPath: (projectId: string, path: string | null) => void;
  setShortcutEditor: (projectId: string, open: boolean, editingId?: string | null) => void;
  setShareHub: (projectId: string, open: boolean, label?: string, command?: string) => void;
}

export const useProjectDialogStore = create<ProjectDialogStore>((set, get) => ({
  entries: {},

  get: (projectId) => get().entries[projectId] ?? DEFAULT_DIALOG_ENTRY,

  setFilePreviewPath: (projectId, path) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [projectId]: { ...(s.entries[projectId] ?? DEFAULT_DIALOG_ENTRY), filePreviewPath: path },
      },
    })),

  setShortcutEditor: (projectId, open, editingId = null) =>
    set((s) => ({
      entries: {
        ...s.entries,
        [projectId]: {
          ...(s.entries[projectId] ?? DEFAULT_DIALOG_ENTRY),
          shortcutEditorOpen: open,
          shortcutEditingId: open ? editingId : null,
        },
      },
    })),

  setShareHub: (projectId, open, label = '', command = '') =>
    set((s) => ({
      entries: {
        ...s.entries,
        [projectId]: {
          ...(s.entries[projectId] ?? DEFAULT_DIALOG_ENTRY),
          shareHubOpen: open,
          shareHubLabel: open ? label : '',
          shareHubCommand: open ? command : '',
        },
      },
    })),
}));
