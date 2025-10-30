import type { AIService } from './ai-service';
import type { PromptBuilderResolver } from './prompt-builder';
import type { ConversationRepository } from './conversation-repository';
import type { SupportedTool } from './client-registry';

type AIChatPort = Pick<AIService, 'chat'>;
type ConversationStore = Pick<ConversationRepository, 'getOrCreate' | 'append' | 'trim'>;

export type AskUseCaseInput = {
  tool: SupportedTool;
  model: string;
  userInput: string;
  designContext?: string;
  conversationId?: string;
  options?: { timeoutMs?: number };
};

export type AskUseCaseResult = {
  content: string;
  conversationId: string;
  raw: Record<string, unknown>;
};

export class AskUseCase {
  constructor(
    private readonly aiService: AIChatPort,
    private readonly promptBuilders: PromptBuilderResolver,
    private readonly conversations: ConversationStore,
    private readonly maxHistory: number,
  ) {}

  async execute(input: AskUseCaseInput): Promise<AskUseCaseResult> {
    const { tool, userInput, designContext, conversationId, options } = input;

    const conversation = await this.conversations.getOrCreate(conversationId);

    const builder = this.promptBuilders.resolve(tool);
    const trimmedDesignContext = designContext?.trim();
    if (trimmedDesignContext) {
      builder.withDesignContext(trimmedDesignContext);
    }

    const messages = builder
      .withHistory(conversation.history)
      .withUser(userInput)
      .build();

    const aiResult = await this.aiService.chat(tool, messages, options);

    await this.conversations.append(
      conversation.id,
      { role: 'user', content: userInput },
      { role: 'assistant', content: aiResult.content },
    );

    await this.conversations.trim(conversation.id, this.maxHistory);

    return {
      content: aiResult.content,
      conversationId: conversation.id,
      raw: aiResult.raw,
    };
  }
}
