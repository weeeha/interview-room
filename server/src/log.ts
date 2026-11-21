export type LogLevel = "debug" | "info" | "warn" | "error";

const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? "info") as LogLevel;
  return order[raw] ?? order.info;
}

function write(level: LogLevel, scope: string, msg: string, extra?: unknown): void {
  if (order[level] < minLevel()) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (extra === undefined) sink(line);
  else sink(line, extra);
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, extra?: unknown) => write("debug", scope, msg, extra),
    info: (msg: string, extra?: unknown) => write("info", scope, msg, extra),
    warn: (msg: string, extra?: unknown) => write("warn", scope, msg, extra),
    error: (msg: string, extra?: unknown) => write("error", scope, msg, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;
