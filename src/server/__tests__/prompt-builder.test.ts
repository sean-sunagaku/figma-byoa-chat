import { describe, expect, it } from '@jest/globals';
import {
  CodexPromptBuilder,
  ClaudePromptBuilder,
  PromptBuilderRegistry,
  type PromptBuilder,
} from '../prompt-builder';
import type { ChatMessage } from '../client-registry';

// PromptBuilder の構築ロジックに関するテスト。
// Spec refs: TEST_PLAN PromptBuilderRegistry/Codex/Claude, DESIGN 4.1 PromptBuilder

describe('PromptBuilderRegistry', () => {
  it('tool に応じて対応するビルダーを返す', () => {
    // Arrange
    const registry = new PromptBuilderRegistry();

    // Act
    const codexBuilder = registry.resolve('codex');
    const claudeBuilder = registry.resolve('claude');

    // Assert
    expect(codexBuilder).toBeInstanceOf(CodexPromptBuilder);
    expect(claudeBuilder).toBeInstanceOf(ClaudePromptBuilder);
    // @ts-expect-error 故意に未対応ツールを渡して例外を検証
    expect(() => registry.resolve('unknown')).toThrow(new Error('Unsupported tool: unknown'));
  });
});

describe('CodexPromptBuilder', () => {
  it('デザイン文脈・履歴・ユーザー入力を順序通りに組み立てる', () => {
    // Arrange
    const builder = new CodexPromptBuilder();
    const designContext = '選択中: FrameA, FrameB';
    const history: ChatMessage[] = [
      { role: 'user', content: '前回の質問' },
      { role: 'assistant', content: '前回の回答' },
    ];
    const userInput = '改善点を提案して';

    // Act
    const messages = builder
      .withDesignContext(designContext)
      .withHistory(history)
      .withUser(userInput)
      .build();

    // Assert
    expect(messages).toEqual([
      {
        role: 'system',
        content: 'あなたはFigmaのUI/UXデザイナーです。簡潔かつ実践的に提案してください。',
      },
      {
        role: 'system',
        content: `【Figma構成】\n${designContext}`,
      },
      ...history,
      { role: 'user', content: userInput },
    ]);
  });

  it('空白/未指定のデザイン文脈は追加しない', () => {
    const builder = new CodexPromptBuilder();
    const messages = builder.withDesignContext('   ').withUser('質問').build();

    expect(messages).toEqual([
      {
        role: 'system',
        content: 'あなたはFigmaのUI/UXデザイナーです。簡潔かつ実践的に提案してください。',
      },
      { role: 'user', content: '質問' },
    ]);
  });
});

describe('ClaudePromptBuilder', () => {
  it('Claude 用システム文で開始し Codex との差分を保つ', () => {
    // Arrange
    const builder = new ClaudePromptBuilder();
    const messages = builder.withUser('Claude向けの質問').build();

    // Assert
    expect(messages[0]).toEqual({
      role: 'system',
      content: 'あなたはUI/UXパートナー。箇条書きで「改善→理由→次アクション」を簡潔に出力。',
    });
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'Claude向けの質問' });

    const codexFirst = new CodexPromptBuilder().withUser('質問').build()[0];
    expect(codexFirst.content).not.toEqual(messages[0].content);
  });
});
