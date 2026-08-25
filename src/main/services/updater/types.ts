export interface UpdateCheckResult {
  status: string;
  version?: string;
  readyToInstall?: boolean;
}

export interface UpdateStatusPayload {
  state: string;
  progress?: number;
  version?: string;
  message?: string;
}

export interface UpdateInstallResult {
  ok: boolean;
  message: string;
  version?: string;
}

export interface UpdaterService {
  check(): Promise<UpdateCheckResult>;
  restartAndInstall(): Promise<UpdateInstallResult>;
  dispose(): void;
}
