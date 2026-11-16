export declare const DEFAULT_BASE_URL: string;
export declare const DEFAULT_PATHS: string[];
export declare const DEFAULT_TIMEOUT_SEC: number;
export declare const DEFAULT_INTERVAL_SEC: number;

export interface DeployConfig {
  baseUrl: string;
  paths: string[];
  timeoutMs: number;
  intervalMs: number;
}

export interface WaitForReadyOptions {
  baseUrl: string;
  paths: string[];
  timeoutMs: number;
  intervalMs: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

export declare function parseDeployConfig(
  env?: Record<string, string | undefined>
): DeployConfig;

export declare function waitForReady(
  options: WaitForReadyOptions
): Promise<{ attempts: number; elapsedMs: number }>;

/** CLI 入口：0 = 就绪，1 = 超时 / 配置非法（不抛，便于断言退出码） */
export declare function runCli(
  env?: Record<string, string | undefined>,
  deps?: Partial<WaitForReadyOptions>
): Promise<number>;
