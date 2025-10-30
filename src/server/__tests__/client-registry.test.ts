import { describe, expect, it } from '@jest/globals';
import { ChatClient, ClientRegistry, SupportedTool } from '../client-registry';

class DummyClient implements ChatClient {
  constructor(private readonly tool: SupportedTool) {}

  supports(target: SupportedTool) {
    return target === this.tool;
  }

  async chat() {
    return { content: '', raw: {} };
  }
}

describe('ClientRegistry', () => {
  it('登録済みツールに対して対応クライアントを返す', () => {
    // Arrange
    const codexClient = new DummyClient('codex');
    const claudeClient = new DummyClient('claude');
    const registry = new ClientRegistry([codexClient, claudeClient]);

    // Act & Assert
    expect(registry.resolve('codex')).toBe(codexClient);
    expect(registry.resolve('claude')).toBe(claudeClient);
  });

  it('未登録ツールでは例外を投げる', () => {
    // Arrange
    const codexClient = new DummyClient('codex');
    const registry = new ClientRegistry([codexClient]);

    // Act & Assert
    // @ts-expect-error 故意に未登録ツールを渡してエラーハンドリングを検証
    expect(() => registry.resolve('unknown')).toThrow(
      new Error('No client for tool: unknown'),
    );
  });
});
