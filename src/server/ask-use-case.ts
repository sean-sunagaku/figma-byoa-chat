import type { AIService } from './ai-service';
import type { PromptBuilderResolver } from './prompt-builder';
import type { ConversationRepository } from './conversation-repository';
import type { SupportedTool } from './client-registry';
import type { ChatResponseFormatter } from './response-formatter';
import { formatterDisplayVersion } from './response-formatter';

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
    private readonly responseFormatter: ChatResponseFormatter,
  ) {}

  async execute(input: AskUseCaseInput): Promise<AskUseCaseResult> {
    const { tool, userInput, designContext, conversationId, options } = input;

    const conversation = await this.conversations.getOrCreate(conversationId);

    const builder = this.promptBuilders.resolve(tool);
    const trimmedDesignContext = designContext?.trim();
    const effectiveDesignContext = trimmedDesignContext && trimmedDesignContext.length > 0
      ? trimmedDesignContext
      : undefined;
    if (effectiveDesignContext) {
      builder.withDesignContext(effectiveDesignContext);
    }

    const messages = builder
      .withHistory(conversation.history)
      .withUser(userInput)
      .build();

    const aiResult = await this.aiService.chat(tool, messages, options);

    const formatted = this.responseFormatter.format({
      tool,
      userInput,
      designContext: effectiveDesignContext,
      originalContent: aiResult.content,
      history: conversation.history,
    });

    await this.conversations.append(
      conversation.id,
      { role: 'user', content: userInput },
      { role: 'assistant', content: aiResult.content },
    );

    await this.conversations.trim(conversation.id, this.maxHistory);

    return {
      content: formatted.text,
      conversationId: conversation.id,
      raw: {
        ...aiResult.raw,
        formatter: {
          version: formatterDisplayVersion,
          summary: formatted.summary,
          improvements: formatted.improvements,
          nextActions: formatted.nextActions,
          designContextNote: formatted.designContextNote,
          originalContent: aiResult.content,
        },
      },
    };
  }
}
