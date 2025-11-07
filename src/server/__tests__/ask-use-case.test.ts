import { describe, expect, it, jest } from '@jest/globals';
import { AskUseCase, type AskUseCaseInput } from '../ask-use-case';
import type { AIService } from '../ai-service';
import type { PromptBuilder, PromptBuilderRegistry, PromptBuilderResolver } from '../prompt-builder';
import type { ConversationRepository } from '../conversation-repository';
import type { ChatMessage, SupportedTool } from '../client-registry';
import type {
  ChatResponseFormatter,
  FormattedResponse,
  FormatContext,
} from '../response-formatter';
import { formatterDisplayVersion } from '../response-formatter';

// AskUseCase の振る舞いテスト。
// Spec refs: TEST_PLAN /ask 正常系・異常系、DESIGN 4.0 AskUseCase

type ExecuteInput = AskUseCaseInput;

type MockBuilderConfig = {
  callOrder?: string[];
  buildResult?: ChatMessage[];
};

class MockPromptBuilder implements PromptBuilder {
  private readonly order?: string[];
  private readonly result: ChatMessage[];

  constructor(config: MockBuilderConfig = {}) {
    this.order = config.callOrder;
    this.result = config.buildResult ? [...config.buildResult] : [];
  }

  withDesignContext = jest.fn((text?: string | null) => {
    if (this.order) this.order.push('withDesignContext');
    return this;
  });

  withHistory = jest.fn((history?: ChatMessage[]) => {
    if (this.order) this.order.push('withHistory');
    return this;
  });

  withUser = jest.fn((input: string) => {
    if (this.order) this.order.push('withUser');
    return this;
  });

  build = jest.fn(() => {
    if (this.order) this.order.push('build');
    return [...this.result];
  });
}

type ConversationRepoMocks = {
  getOrCreate: jest.MockedFunction<ConversationRepository['getOrCreate']>;
  append: jest.MockedFunction<ConversationRepository['append']>;
  trim: jest.MockedFunction<ConversationRepository['trim']>;
};

type CreateUseCaseOptions = {
  promptBuilder?: MockPromptBuilder;
  aiChat?: jest.MockedFunction<AIService['chat']>;
  conversationOverrides?: Partial<ConversationRepoMocks>;
  maxHistory?: number;
  formatterResult?: FormattedResponse;
};

const createUseCase = (options: CreateUseCaseOptions = {}) => {
  const promptBuilder = options.promptBuilder ?? new MockPromptBuilder();

  const resolve = jest.fn<PromptBuilderRegistry['resolve']>(() => promptBuilder);
  const promptRegistry: PromptBuilderResolver = { resolve };

  const defaultGetOrCreate = jest.fn<ConversationRepository['getOrCreate']>(async (conversationId?: string) => ({
    id: conversationId ?? 'new-id',
    history: [],
  }));
  const defaultAppend = jest.fn<ConversationRepository['append']>(async () => undefined);
  const defaultTrim = jest.fn<ConversationRepository['trim']>(async () => undefined);

  const repoMocks: ConversationRepoMocks = {
    getOrCreate: options.conversationOverrides?.getOrCreate ?? defaultGetOrCreate,
    append: options.conversationOverrides?.append ?? defaultAppend,
    trim: options.conversationOverrides?.trim ?? defaultTrim,
  };

  const conversationRepository: Pick<ConversationRepository, 'getOrCreate' | 'append' | 'trim'> = {
    getOrCreate: repoMocks.getOrCreate,
    append: repoMocks.append,
    trim: repoMocks.trim,
  };

  const defaultAiChat = jest.fn<AIService['chat']>(async () => ({ content: '', raw: {} }));
  const aiChat = options.aiChat ?? defaultAiChat;
  const aiServicePort: Pick<AIService, 'chat'> = { chat: aiChat };

  const formatterResult: FormattedResponse =
    options.formatterResult ??
    ({ text: 'formatted', summary: [], improvements: [], nextActions: [] } as FormattedResponse);
  const format = jest
    .fn((_: FormatContext) => formatterResult)
    .mockName('ChatResponseFormatter.format') as jest.MockedFunction<ChatResponseFormatter['format']>;
  const responseFormatter: ChatResponseFormatter = { format };

  const useCase = new AskUseCase(
    aiServicePort,
    promptRegistry,
    conversationRepository,
    options.maxHistory ?? 50,
    responseFormatter,
  );

  return {
    useCase,
    promptBuilder,
    promptRegistry,
    conversationRepositoryMocks: repoMocks,
    aiChat,
    resolve,
    responseFormatter,
    formatterResult,
  };
};

const baseInput: ExecuteInput = {
  tool: 'codex',
  model: 'codex:local',
  userInput: '改善ポイントを教えて',
  designContext: '選択中のレイヤーA/B',
  conversationId: undefined,
  options: undefined,
};

describe('AskUseCase', () => {
  it('会話を新規作成し履歴を保存する', async () => {
    // Arrange (SPEC: TEST_PLAN /ask 新規会話 正常系)
    const builtMessages: ChatMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: baseInput.userInput },
    ];
    const builder = new MockPromptBuilder({ buildResult: builtMessages });

    const aiResponse = { content: 'AI output', raw: { source: 'codex-cli' } };
    const aiChat = jest.fn<AIService['chat']>(async () => aiResponse);

    const formatterResult: FormattedResponse = {
      text: '整形済み',
      summary: ['summary'],
      improvements: [{ point: 'improve', rationale: 'because' }],
      nextActions: ['next'],
      designContextNote: '選択中のレイヤーA/B',
    };

    const { useCase, conversationRepositoryMocks, resolve, promptBuilder, responseFormatter } = createUseCase({
      promptBuilder: builder,
      aiChat,
      formatterResult,
    });

    // Act
    const result = await useCase.execute(baseInput);

    // Assert
    expect(result).toEqual({
      content: formatterResult.text,
      conversationId: 'new-id',
      raw: {
        ...aiResponse.raw,
        formatter: {
          version: formatterDisplayVersion,
          summary: formatterResult.summary,
          improvements: formatterResult.improvements,
          nextActions: formatterResult.nextActions,
          designContextNote: formatterResult.designContextNote,
          originalContent: aiResponse.content,
        },
      },
    });
    expect(conversationRepositoryMocks.getOrCreate).toHaveBeenCalledWith(undefined);
    expect(resolve).toHaveBeenCalledWith('codex');
    expect(promptBuilder.withDesignContext).toHaveBeenCalledWith(baseInput.designContext);
    expect(promptBuilder.withHistory).toHaveBeenCalledWith([]);
    expect(promptBuilder.withUser).toHaveBeenCalledWith(baseInput.userInput);
    expect(aiChat).toHaveBeenCalledWith(baseInput.tool, builtMessages, undefined);
    expect(responseFormatter.format).toHaveBeenCalledWith({
      tool: baseInput.tool,
      userInput: baseInput.userInput,
      designContext: baseInput.designContext,
      originalContent: aiResponse.content,
      history: [],
    });
    expect(conversationRepositoryMocks.append).toHaveBeenCalledWith('new-id',
      { role: 'user', content: baseInput.userInput },
      { role: 'assistant', content: aiResponse.content },
    );
    expect(conversationRepositoryMocks.trim).toHaveBeenCalledWith('new-id', 50);
  });

  it('既存会話の履歴を引き継ぎ AI へ渡す', async () => {
    // Arrange (SPEC: TEST_PLAN /ask 既存会話 正常系)
    const history: ChatMessage[] = [
      { role: 'user', content: '前回の質問' },
      { role: 'assistant', content: '前回の回答' },
    ];

    const builder = new MockPromptBuilder({ buildResult: history });
    const aiResponse = { content: 'follow-up', raw: { source: 'codex-cli' } };
    const aiChat = jest.fn<AIService['chat']>(async () => aiResponse);

    const getOrCreate = jest.fn<ConversationRepository['getOrCreate']>(async () => ({
      id: 'existing-id',
      history,
    }));

    const { useCase, conversationRepositoryMocks, promptBuilder, responseFormatter } = createUseCase({
      promptBuilder: builder,
      aiChat,
      conversationOverrides: { getOrCreate },
    });

    const input: ExecuteInput = { ...baseInput, conversationId: 'existing-id' };

    await useCase.execute(input);

    expect(conversationRepositoryMocks.getOrCreate).toHaveBeenCalledWith('existing-id');
    expect(promptBuilder.withHistory).toHaveBeenCalledWith(history);
    expect(aiChat).toHaveBeenCalledWith('codex', history, undefined);
    expect(responseFormatter.format).toHaveBeenCalledWith({
      tool: input.tool,
      userInput: input.userInput,
      designContext: input.designContext,
      originalContent: aiResponse.content,
      history,
    });
    expect(conversationRepositoryMocks.append).toHaveBeenCalledWith('existing-id',
      { role: 'user', content: baseInput.userInput },
      { role: 'assistant', content: aiResponse.content },
    );
  });

  it('空白のみの designContext を無視する', async () => {
    // Arrange (SPEC: TEST_PLAN AskUseCase で designContext 空文字)
    const builder = new MockPromptBuilder();
    const { useCase, promptBuilder, responseFormatter } = createUseCase({ promptBuilder: builder });

    const input: ExecuteInput = { ...baseInput, designContext: '   ' };

    await useCase.execute(input);

    expect(promptBuilder.withDesignContext).not.toHaveBeenCalled();
    expect(responseFormatter.format).toHaveBeenCalledWith({
      tool: input.tool,
      userInput: input.userInput,
      designContext: undefined,
      originalContent: '',
      history: [],
    });
  });

  it('options.timeoutMs を AIService に透過する', async () => {
    // Arrange (SPEC: TEST_PLAN AskUseCase options.timeoutMs 透過)
    const builtMessages: ChatMessage[] = [];
    const builder = new MockPromptBuilder({ buildResult: builtMessages });

    const aiChat = jest.fn<AIService['chat']>(async () => ({ content: '', raw: {} }));
    const { useCase } = createUseCase({ promptBuilder: builder, aiChat });

    const options = { timeoutMs: 120_000 };
    const input: ExecuteInput = { ...baseInput, options };

    await useCase.execute(input);

    expect(aiChat).toHaveBeenCalledWith('codex', builtMessages, options);
  });

  it('PromptBuilder チェーンを順序通りに実行する', async () => {
    // Arrange (SPEC: TEST_PLAN PromptBuilder チェーン確認)
    const order: string[] = [];
    const builder = new MockPromptBuilder({ callOrder: order });
    const { useCase } = createUseCase({ promptBuilder: builder });

    await useCase.execute(baseInput);

    expect(order).toEqual(['withDesignContext', 'withHistory', 'withUser', 'build']);
  });
});
