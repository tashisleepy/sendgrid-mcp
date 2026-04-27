// Structured logger for the MCP server.
//
// MCP uses stdio for protocol traffic (stdout). All operational logs MUST
// go to stderr to avoid corrupting JSON-RPC frames. We emit a single line
// of JSON per log event so the user (or any downstream collector) can
// parse without regex.
//
// PII safety: callers are responsible for sanitizing payloads. This module
// will NOT auto-redact — it only provides structure. The error handler in
// src/index.ts already sanitizes axios errors before passing them here.

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const ENV_LEVEL = (process.env.SENDGRID_MCP_LOG_LEVEL?.toLowerCase() || 'info') as Level;
const THRESHOLD = LEVELS[ENV_LEVEL] ?? LEVELS.info;

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < THRESHOLD) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta ?? {}),
  });
  // ALWAYS stderr — stdout is reserved for the MCP protocol
  process.stderr.write(line + '\n');
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
};

// Generate a short request id for correlating tool-call logs with errors.
export function requestId(): string {
  return Math.random().toString(36).slice(2, 10);
}
