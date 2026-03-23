type LogLevel = "error" | "warn" | "info" | "debug";

const LOG_LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function formatTimestamp(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
}

export const logger = {
  error(message: string, ...args: unknown[]): void {
    if (shouldLog("error")) {
      console.error(`[${formatTimestamp()}] [ERROR] ${message}`, ...args);
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (shouldLog("warn")) {
      console.warn(`[${formatTimestamp()}] [WARN] ${message}`, ...args);
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (shouldLog("info")) {
      console.log(`[${formatTimestamp()}] [INFO] ${message}`, ...args);
    }
  },

  log(message: string, ...args: unknown[]): void {
    if (shouldLog("info")) {
      console.log(`[${formatTimestamp()}] [INFO] ${message}`, ...args);
    }
  },

  debug(message: string, ...args: unknown[]): void {
    if (shouldLog("debug")) {
      console.log(`[${formatTimestamp()}] [DEBUG] ${message}`, ...args);
    }
  },
};
