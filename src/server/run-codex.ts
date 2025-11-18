import { spawn } from 'node:child_process';

export type CodexRunner = (prompt: string, timeoutMs?: number) => Promise<string>;

type CodexRunnerOptions = {
  disabledMcpServers?: string[];
};

type CodexJsonEvent = {
  type?: string;
  message?: string;
  item?: {
    type?: string;
    text?: string;
  };
};

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

const buildDisableArgs = (servers?: string[]): string[] => {
  if (!servers?.length) {
    return [];
  }

  return servers
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .flatMap((name) => ['-c', `mcp_servers.${name}.enabled=false`]);
};

export const createCodexRunner = (command: string, options: CodexRunnerOptions = {}): CodexRunner => {
  const disabledArgs = buildDisableArgs(options.disabledMcpServers);

  return (prompt, timeoutMs) =>
    new Promise<string>((resolve, reject) => {
      const args = ['exec', '--json', ...disabledArgs, prompt];
      const child = spawn(command, args, {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      let stdoutBuffer = '';
      const agentMessages: string[] = [];
      const warnings: string[] = [];

      const processLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return;
        }

        try {
          const event = JSON.parse(trimmed) as CodexJsonEvent;
          if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
            const text = event.item.text?.trim();
            if (text) {
              agentMessages.push(text);
            }
            return;
          }

          if (event.type === 'error' && event.message) {
            warnings.push(event.message.trim());
          }
        } catch (error) {
          warnings.push(`Failed to parse Codex JSON: ${trimmed}`);
          console.warn('[CodexRunner] JSON parse warning:', error);
        }
      };

      const timeoutMillis =
        typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
          ? timeoutMs
          : DEFAULT_TIMEOUT_MS;

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Codex CLI の応答がタイムアウトしました。'));
      }, timeoutMillis);

      child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk.toString();

        let newlineIndex = stdoutBuffer.indexOf('\n');
        while (newlineIndex !== -1) {
          const line = stdoutBuffer.slice(0, newlineIndex);
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
          processLine(line);
          newlineIndex = stdoutBuffer.indexOf('\n');
        }
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        clearTimeout(timer);

        if (stdoutBuffer.trim()) {
          processLine(stdoutBuffer);
        }

        const output = agentMessages.join('\n\n').trim();

        if (output) {
          if (warnings.length > 0) {
            console.warn('[CodexRunner] CLI warnings:', warnings.join(' | '));
          }

          if (code !== 0) {
            console.warn(
              `[CodexRunner] CLI exited with code ${code} but produced a response. Returning the response.`,
            );
          }

          resolve(output);
          return;
        }

        const errorMessage =
          warnings.join(' | ').trim() || stderr.trim() || `Codex CLI exited with code ${code}`;
        reject(new Error(errorMessage));
      });
    });
};
