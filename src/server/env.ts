export type ServerConfig = {
  host: string;
  port: number;
  maxHistory: number;
  codexCommand: string;
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5000;
const DEFAULT_MAX_HISTORY = 50;
const DEFAULT_CODEX_COMMAND = 'codex';

export const loadServerConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => {
  const host = env.HOST?.trim() || DEFAULT_HOST;

  const port = parseNumber(env.PORT, DEFAULT_PORT);
  const maxHistory = parseNumber(env.MAX_HISTORY, DEFAULT_MAX_HISTORY);
  const codexCommand = env.CODEX_CMD?.trim() || DEFAULT_CODEX_COMMAND;

  return { host, port, maxHistory, codexCommand };
};

const parseNumber = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
