import type { ChatMessage, SupportedTool } from './client-registry';
import { UnsupportedToolError } from './errors';

export interface PromptBuilder {
  withDesignContext(text?: string | null): this;
  withHistory(history?: ChatMessage[]): this;
  withUser(input: string): this;
  build(): ChatMessage[];
}

export class BasePromptBuilder implements PromptBuilder {
  protected readonly messages: ChatMessage[] = [];

  withDesignContext(text?: string | null): this {
    const trimmed = text?.trim();
    if (trimmed) {
      this.messages.push({ role: 'system', content: `【Figma構成】\n${trimmed}` });
    }
    return this;
  }

  withHistory(history?: ChatMessage[]): this {
    if (history?.length) {
      this.messages.push(...history.map((message) => ({ ...message })));
    }
    return this;
  }

  withUser(input: string): this {
    this.messages.push({ role: 'user', content: input });
    return this;
  }

  build(): ChatMessage[] {
    return this.messages.map((message) => ({ ...message }));
  }
}

export class CodexPromptBuilder extends BasePromptBuilder {
  constructor() {
    super();
    this.messages.push({
      role: 'system',
      content: 'あなたはFigmaのUI/UXデザイナーです。簡潔かつ実践的に提案してください。',
    });
  }
}

export class ClaudePromptBuilder extends BasePromptBuilder {
  constructor() {
    super();
    this.messages.push({
      role: 'system',
      content: 'あなたはUI/UXパートナー。箇条書きで「改善→理由→次アクション」を簡潔に出力。',
    });
  }
}

export type PromptBuilderResolver = {
  resolve(tool: SupportedTool): PromptBuilder;
};

export class PromptBuilderRegistry implements PromptBuilderResolver {
  resolve(tool: SupportedTool): PromptBuilder {
    switch (tool) {
      case 'codex':
        return new CodexPromptBuilder();
      case 'claude':
        return new ClaudePromptBuilder();
      default:
        throw new UnsupportedToolError(tool);
    }
  }
}
