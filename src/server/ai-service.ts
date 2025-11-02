import type { ChatMessage, ClientResolver, SupportedTool } from './client-registry';

export class AIService {
  constructor(private readonly registry: ClientResolver) {}

  async chat(tool: SupportedTool, messages: ChatMessage[], options?: Record<string, unknown>) {
    const client = this.registry.resolve(tool);
    return client.chat(messages, options);
  }
}
