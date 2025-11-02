import { spawn } from 'node:child_process';

export type CodexRunner = (prompt: string, timeoutMs?: number) => Promise<string>;

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

export const createCodexRunner = (command: string): CodexRunner => {
  return (prompt, timeoutMs) =>
    new Promise<string>((resolve, reject) => {
      const child = spawn(command, ['exec', prompt], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const timeoutMillis =
        typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)
          ? timeoutMs
          : DEFAULT_TIMEOUT_MS;

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Codex CLI の応答がタイムアウトしました。'));
      }, timeoutMillis);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
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

        if (code === 0) {
          resolve(stdout.trim());
        } else {
          const message = stderr.trim() || `Codex CLI exited with code ${code}`;
          reject(new Error(message));
        }
      });
    });
};
