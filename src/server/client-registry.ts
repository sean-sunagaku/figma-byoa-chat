export type SupportedTool = 'codex' | 'claude';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatClient {
  supports(tool: SupportedTool): boolean;
  chat(messages: ChatMessage[], options?: Record<string, unknown>): Promise<{
    content: string;
    raw: Record<string, unknown>;
  }>;
}

export interface ClientResolver {
  resolve(tool: SupportedTool): ChatClient;
}

export class ClientRegistry implements ClientResolver {
  constructor(private readonly clients: ChatClient[]) {}

  resolve(tool: SupportedTool): ChatClient {
    const client = this.clients.find((entry) => entry.supports(tool));
    if (!client) {
      throw new Error(`No client for tool: ${tool}`);
    }
    return client;
  }
}
