import { create } from 'zustand';

interface AppState {
  user: { id: string; email: string; credits: number; role?: string; tier?: string; monthly_allowance?: number } | null;
  setUser: (user: { id: string; email: string; credits: number; role?: string; tier?: string; monthly_allowance?: number } | null | ((prev: { id: string; email: string; credits: number; role?: string; tier?: string; monthly_allowance?: number } | null) => { id: string; email: string; credits: number; role?: string; tier?: string; monthly_allowance?: number } | null)) => void;
  updateCredits: (credits: number) => void;
  
  history: { id: string; type: string; url: string; prompt: string; created_at: number; folder_id?: string | null }[];
  folders: { id: string; name: string; created_at: number }[];
  setHistory: (history: { id: string; type: string; url: string; prompt: string; created_at: number; folder_id?: string | null }[]) => void;
  setFolders: (folders: { id: string; name: string; created_at: number }[]) => void;
  addHistoryItem: (item: { id: string; type: string; url: string; prompt: string; created_at: number; folder_id?: string | null }) => void;

  studioNodes: any[];
  studioEdges: any[];
  setStudioNodes: (nodes: any[] | ((prev: any[]) => any[])) => void;
  setStudioEdges: (edges: any[] | ((prev: any[]) => any[])) => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  setUser: (userOrFn) => set((state) => ({ 
    user: typeof userOrFn === 'function' ? userOrFn(state.user) : userOrFn 
  })),
  updateCredits: (credits) => set((state) => ({ user: state.user ? { ...state.user, credits } : null })),
  
  history: [],
  folders: [],
  setHistory: (history) => set({ history }),
  setFolders: (folders) => set({ folders }),
  addHistoryItem: (item) => set((state) => ({ history: [item, ...state.history] })),

  studioNodes: [],
  studioEdges: [],
  setStudioNodes: (nodesOrFn) => set((state) => ({ studioNodes: typeof nodesOrFn === 'function' ? nodesOrFn(state.studioNodes) : nodesOrFn })),
  setStudioEdges: (edgesOrFn) => set((state) => ({ studioEdges: typeof edgesOrFn === 'function' ? edgesOrFn(state.studioEdges) : edgesOrFn })),
}));
