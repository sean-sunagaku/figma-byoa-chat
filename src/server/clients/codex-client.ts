import type { ChatClient, ChatMessage, SupportedTool } from '../client-registry';
import type { CodexRunner } from '../run-codex';

export class CodexClient implements ChatClient {
  constructor(private readonly runCodex: CodexRunner) {}

  supports(tool: SupportedTool): boolean {
    return tool === 'codex';
  }

  async chat(messages: ChatMessage[], options?: Record<string, unknown>) {
    const prompt = composePrompt(messages);
    const timeout = typeof options?.timeoutMs === 'number' ? options.timeoutMs : undefined;

    try {
      const output = await this.runCodex(prompt, timeout);
      return {
        content: output,
        raw: { source: 'codex-cli' },
      };
    } catch (error) {
      console.error('[CodexClient] Codex CLI error, fallback response returned:', error);
      return {
        content: buildFallbackAnswer(messages),
        raw: { source: 'codex-fallback', error: serializeError(error) },
      };
    }
  }
}

const composePrompt = (messages: ChatMessage[]): string =>
  messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n');

const buildFallbackAnswer = (messages: ChatMessage[]): string => {
  const userMessage = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const designContext = messages
    .filter((message) => message.role === 'system' && message.content.includes('【Figma構成】'))
    .map((message) => message.content.replace('【Figma構成】', '').trim())
    .join('\n');

  const sections: string[] = [];

  if (userMessage) {
    sections.push('**ユーザーからの要望**', userMessage.trim(), '');
  }

  if (designContext) {
    sections.push('**観察したデザインの状況**', designContext, '');
  }

  sections.push('**改善のヒント**');
  sections.push(
    '1. ファーストビューでは主要メッセージとCTAをスクロール前に収め、視認性を高める余白とタイポグラフィを確保する。',
  );
  sections.push('2. セクションごとに背景トーンや見出しレベルを変え、縦長レイアウトでも情報の塊を把握しやすくする。');
  sections.push('3. ツールバーとフッターはアクセシブルなコントラストを維持し、主要な行動導線を常に提示する。');
  sections.push('4. ボタンエリアはプライマリCTAと補足リンクを整理し、必要に応じてスクロール追従表示で離脱を防ぐ。');
  sections.push('5. カラーパレットやタイポグラフィスタイルはコンポーネント化し、再利用と一貫性を促進する。');

  sections.push('', '※ この回答は自動補完されたヒントであり、最終提案時には文脈に合わせてブラッシュアップしてください。');

  return sections.join('\n');
};

const serializeError = (error: unknown): { message: string } | undefined => {
  if (!error) {
    return undefined;
  }
  if (error instanceof Error) {
    return { message: error.message };
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  return { message: JSON.stringify(error) };
};
