import { describe, expect, it, jest } from '@jest/globals';
import { AIService } from '../ai-service';
import type { ChatClient, ChatMessage, ClientResolver, SupportedTool } from '../client-registry';

// AIService.chat の委譲ロジックに関するテスト。
// Spec refs: TEST_PLAN AIService.chat 委譲, DESIGN 4.2 Client

const createMessages = (): ChatMessage[] => [
  { role: 'system', content: 's' },
  { role: 'user', content: 'u' },
];

describe('AIService', () => {
  it('tool に応じて ClientRegistry.resolve の戻り値に chat を委譲する', async () => {
    // Arrange
    const messages = createMessages();
    const options = { timeoutMs: 12_000 };
    const chatResult = { content: 'ok', raw: { source: 'stub' } };

    const supportsFn = jest.fn<(tool: SupportedTool) => boolean>().mockReturnValue(true);
    const chatFn = jest
      .fn<ChatClient['chat']>(async (_messages, _options) => chatResult)
      .mockName('chat');

    const mockClient: ChatClient = {
      supports: supportsFn,
      chat: chatFn,
    };

    const registry: ClientResolver = {
      resolve: jest.fn(() => mockClient),
    };

    const service = new AIService(registry);

    // Act
    const result = await service.chat('codex', messages, options);

    // Assert
    expect(registry.resolve).toHaveBeenCalledWith('codex');
    expect(chatFn).toHaveBeenCalledWith(messages, options);
    expect(result).toEqual(chatResult);
  });

  it('クライアントの例外を再送出する', async () => {
    // Arrange
    const messages = createMessages();
    const error = new Error('boom');

    const supportsFn = jest.fn<(tool: SupportedTool) => boolean>().mockReturnValue(true);
    const chatFn = jest
      .fn<ChatClient['chat']>(async () => {
        throw error;
      })
      .mockName('chat');

    const mockClient: ChatClient = {
      supports: supportsFn,
      chat: chatFn,
    };

    const registry: ClientResolver = {
      resolve: jest.fn(() => mockClient),
    };

    const service = new AIService(registry);

    // Act & Assert
    await expect(service.chat('claude', messages)).rejects.toBe(error);
    expect(registry.resolve).toHaveBeenCalledWith('claude');
  });
});
