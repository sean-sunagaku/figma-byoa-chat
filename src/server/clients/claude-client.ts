import type { ChatClient, ChatMessage, SupportedTool } from '../client-registry';
import { spawn } from 'child_process';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// CLI runner for Claude Code
type ClaudeRunner = (messages: ChatMessage[]) => Promise<{ content: string; raw: Record<string, unknown> }>;

export class ClaudeClient implements ChatClient {
  constructor(private readonly runner?: ClaudeRunner) {}

  supports(tool: SupportedTool): boolean {
    return tool === 'claude';
  }

  async chat(messages: ChatMessage[]): Promise<{ content: string; raw: Record<string, unknown> }> {
    // If custom runner is provided, use it
    if (this.runner) {
      try {
        return await this.runner(messages);
      } catch (error) {
        console.error('Claude runner error:', error);
        return this.buildFallbackAnswer(messages, error as Error);
      }
    }

    // Otherwise, try to run Claude Code CLI
    try {
      const userMessage = messages.find(msg => msg.role === 'user')?.content || '';
      const systemMessage = messages.find(msg => msg.role === 'system')?.content || '';

      // Combine system and user messages for CLI input
      const prompt = systemMessage ? `${systemMessage}\n\n${userMessage}` : userMessage;

      // Try to execute claude CLI command
      const result = await this.executeClaude(prompt);

      return {
        content: result,
        raw: {
          source: 'claude-cli',
        },
      };
    } catch (error) {
      console.error('Claude CLI error:', error);
      return this.buildFallbackAnswer(messages, error as Error);
    }
  }

  private async executeClaude(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const claudeCmd = process.env.CLAUDE_CMD || 'claude';

      const claude = spawn(claudeCmd, ['chat'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      claude.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      claude.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      claude.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        } else {
          resolve(stdout.trim());
        }
      });

      claude.on('error', (error) => {
        reject(new Error(`Failed to execute Claude CLI: ${error.message}`));
      });

      // Send the prompt to Claude
      claude.stdin.write(prompt);
      claude.stdin.end();
    });
  }

  private buildFallbackAnswer(
    messages: ChatMessage[],
    error: Error
  ): { content: string; raw: Record<string, unknown> } {
    const userMessage = messages.find(msg => msg.role === 'user')?.content || '';
    const figmaContext = messages.find(msg => msg.role === 'system')?.content || '';

    // Extract design information from context
    const hasDesignContext = figmaContext.includes('Figma');
    const errorDetails = this.getErrorDetails(error);

    let fallbackContent = `## ⚠️ Claude接続エラー\n\n`;
    fallbackContent += `**エラー詳細:**\n${errorDetails}\n\n`;

    if (hasDesignContext && userMessage) {
      fallbackContent += `## 📋 代替のデザインアドバイス\n\n`;
      fallbackContent += `あなたの質問: "${userMessage}"\n\n`;
      fallbackContent += `以下の一般的なデザイン改善提案をご確認ください：\n\n`;
      fallbackContent += `### 1. ビジュアルヒエラルキー\n`;
      fallbackContent += `重要な要素を目立たせ、情報の優先順位を明確にしましょう。\n\n`;
      fallbackContent += `### 2. 一貫性の確保\n`;
      fallbackContent += `カラー、フォント、スペーシングを統一してデザインシステムを構築しましょう。\n\n`;
      fallbackContent += `### 3. アクセシビリティ\n`;
      fallbackContent += `コントラスト比やフォントサイズを適切に設定し、すべてのユーザーが使いやすいデザインにしましょう。\n\n`;
      fallbackContent += `### 4. レスポンシブデザイン\n`;
      fallbackContent += `様々なデバイスサイズに対応できる柔軟なレイアウトを検討しましょう。\n\n`;
      fallbackContent += `### 5. パフォーマンス最適化\n`;
      fallbackContent += `画像の最適化やコンポーネントの再利用でパフォーマンスを向上させましょう。\n`;
    }

    fallbackContent += `\n---\n`;
    fallbackContent += `### 🔧 トラブルシューティング\n\n`;
    fallbackContent += this.getTroubleshootingGuide(error);

    return {
      content: fallbackContent,
      raw: {
        error: error.message,
        errorType: error.name,
        fallback: true,
      },
    };
  }

  private getErrorDetails(error: Error): string {
    if (error.message.includes('authentication')) {
      return `認証エラー: Claude Codeがインストールされていないか、ログインされていません。`;
    } else if (error.message.includes('timeout')) {
      return `タイムアウトエラー: リクエストがタイムアウトしました。`;
    } else if (error.message.includes('network')) {
      return `ネットワークエラー: インターネット接続を確認してください。`;
    } else if (error.message.includes('rate limit')) {
      return `レート制限: API利用制限に達しました。しばらく待ってから再試行してください。`;
    } else {
      return `エラー: ${error.message}`;
    }
  }

  private getTroubleshootingGuide(error: Error): string {
    const guides: string[] = [];

    if (error.message.includes('authentication') || error.message.includes('not initialized')) {
      guides.push('1. Claude Codeがインストールされていることを確認してください');
      guides.push('   ```bash\n   npm install -g @anthropic-ai/claude-code\n   ```');
      guides.push('2. Claude Codeにログインしてください');
      guides.push('   ```bash\n   claude login\n   ```');
      guides.push('3. Claude Pro/Maxサブスクリプションが有効であることを確認してください');
    } else if (error.message.includes('timeout')) {
      guides.push('1. インターネット接続を確認してください');
      guides.push('2. タイムアウト設定を増やすことを検討してください（環境変数: CLAUDE_TIMEOUT）');
      guides.push('3. リクエストを再試行してください');
    } else if (error.message.includes('rate limit')) {
      guides.push('1. 現在のレート制限状況を確認してください');
      guides.push('2. しばらく待ってから再試行してください');
      guides.push('3. リクエストの頻度を減らすことを検討してください');
    } else {
      guides.push('1. エラーログを確認してください');
      guides.push('2. Claude Codeの再インストールを検討してください');
      guides.push('3. サポートに問い合わせてください');
    }

    return guides.join('\n');
  }
}

// Keep the old stub client for backward compatibility if needed
export class ClaudeStubClient implements ChatClient {
  supports(tool: SupportedTool): boolean {
    return tool === 'claude';
  }

  async chat(_messages: ChatMessage[]): Promise<{ content: string; raw: Record<string, unknown> }> {
    return {
      content: 'Claude Stub: This is a placeholder. Please configure Claude Agent SDK.',
      raw: { stub: true },
    };
  }
}