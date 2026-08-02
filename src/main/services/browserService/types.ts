import type { DetectedBrowser } from '../../../shared/types';

export interface BrowserCandidate extends Omit<DetectedBrowser, 'profiles' | 'iconDataUrl'> {
  localStatePath?: string;
}

export interface BrowserBackend {
  scan(): Promise<DetectedBrowser[]>;
}

export interface BrowserService {
  list(refresh?: boolean): Promise<DetectedBrowser[]>;
}
