export type ServerConfig = {
  host: string;
  port: number;
  maxHistory: number;
  codexCommand: string;
  claudeCommand: string;
  claudeModel: string;
  codexDisabledMcpServers: string[];
};

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5000;
const DEFAULT_MAX_HISTORY = 50;
const DEFAULT_CODEX_COMMAND = 'codex';
const DEFAULT_CLAUDE_COMMAND = 'claude';
const DEFAULT_CLAUDE_MODEL = 'sonnet';
const DEFAULT_CODEX_DISABLED_MCP = ['serena', 'chrome-devtools', 'playwright'];

export const loadServerConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => {
  const host = env.HOST?.trim() || DEFAULT_HOST;

  const port = parseNumber(env.PORT, DEFAULT_PORT);
  const maxHistory = parseNumber(env.MAX_HISTORY, DEFAULT_MAX_HISTORY);
  const codexCommand = env.CODEX_CMD?.trim() || DEFAULT_CODEX_COMMAND;
  const claudeCommand = env.CLAUDE_CMD?.trim() || DEFAULT_CLAUDE_COMMAND;
  const claudeModel = env.CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
  const codexDisabledMcpServers = parseList(
    env.CODEX_DISABLED_MCP_SERVERS,
    DEFAULT_CODEX_DISABLED_MCP,
  );

  return {
    host,
    port,
    maxHistory,
    codexCommand,
    claudeCommand,
    claudeModel,
    codexDisabledMcpServers,
  };
};

const parseNumber = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseList = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) {
    return fallback;
  }

  const items = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return items.length > 0 ? Array.from(new Set(items)) : fallback;
};
