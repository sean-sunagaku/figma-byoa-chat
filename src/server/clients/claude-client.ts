import type { ChatClient, ChatMessage, SupportedTool } from '../client-registry';
import { UnsupportedToolError } from '../errors';

export class ClaudeStubClient implements ChatClient {
  supports(tool: SupportedTool): boolean {
    return tool === 'claude';
  }

  async chat(_messages: ChatMessage[]): Promise<{ content: string; raw: Record<string, unknown> }> {
    throw new UnsupportedToolError('claude');
  }
}
