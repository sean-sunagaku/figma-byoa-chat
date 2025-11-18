import { spawn } from 'node:child_process';
import type { ChatMessage } from './client-registry';

export type ClaudeRunner = (messages: ChatMessage[]) => Promise<{ content: string; raw: Record<string, unknown> }>;

type ClaudeRunnerOptions = {
  model?: string;
};

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

export const createClaudeRunner = (command: string, options: ClaudeRunnerOptions = {}): ClaudeRunner => {
  const model = options.model?.trim();

  return (messages) =>
    new Promise<{ content: string; raw: Record<string, unknown> }>((resolve, reject) => {
      const userMessage = messages.find(msg => msg.role === 'user')?.content || '';
      const systemMessage = messages.find(msg => msg.role === 'system')?.content || '';

      // Combine system and user messages for CLI input
      const prompt = systemMessage ? `${systemMessage}\n\n${userMessage}` : userMessage;

      const args = ['-p'];
      if (model) {
        args.push('--model', model);
      }
      args.push(prompt);

      const child = spawn(command, args, {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('Claude CLI の応答がタイムアウトしました。'));
      }, DEFAULT_TIMEOUT_MS);

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
          resolve({
            content: stdout.trim(),
            raw: {
              source: 'claude-cli',
              command,
            },
          });
        } else {
          const message = stderr.trim() || `Claude CLI exited with code ${code}`;
          reject(new Error(message));
        }
      });

    });
};
