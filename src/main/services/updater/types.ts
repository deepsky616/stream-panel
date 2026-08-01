export interface UpdateCheckResult {
  status: string;
  version?: string;
}

export interface UpdateStatusPayload {
  state: string;
  progress?: number;
  version?: string;
  message?: string;
}

export interface UpdaterService {
  check(): Promise<UpdateCheckResult>;
  dispose(): void;
}
