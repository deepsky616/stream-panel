import { create } from 'zustand';
import type { AppConfig, DeckLocation } from '../../../shared/types';

interface DeckState {
  config: AppConfig | null;
  location: DeckLocation;
  error: string | null;
  setConfig: (config: AppConfig) => void;
  setLocation: (location: DeckLocation) => void;
  setError: (error: string | null) => void;
}

export const useDeckStore = create<DeckState>((set) => ({
  config: null,
  location: { path: [], page: 0 },
  error: null,
  setConfig: (config) => set({ config }),
  setLocation: (location) => set({ location }),
  setError: (error) => set({ error }),
}));
