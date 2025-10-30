## figma-byoa-chat 設計書（最小骨格・ローカル運用）

本書は、Figma プラグインとローカル AI 実行環境（Codex/Claude Code）を接続するための、最小だが拡張可能な設計をまとめたものです。初期はローカル・認証不要で運用し、将来のプロバイダ追加や調整に耐える構成とします。

---

### 1. 目的と前提
- 目的: Figma からの相談（chat）に対し、ローカルの AI 実行環境へ問い合わせて回答を返す。
- 前提: ローカル実行のみ（127.0.0.1 バインド）、認証情報は不要。BYOA の外部アカウント連携は対象外。
- 切替軸: ツール（tool: codex | claude）、モデル（model: ツール内のバリアント）。
- モードは導入しない（quick/raw 等は不採用）。プロンプトの差異は「モデル別ビルダー」で吸収。
- 初期実装は Codex のみを有効化（Claude は将来追加）。

---

### 2. 全体アーキテクチャ
```mermaid
flowchart LR
  UI[figma ui.html] --> Plugin[code.ts]
  Plugin -->|POST /ask {tool, model, ...}| Hono[Hono Server]
  Hono --> UseCase[AskUseCase (Application)]
  UseCase --> PBReg[PromptBuilderRegistry (by tool)]
  PBReg --> PB[PromptBuilder (Codex/Claude)]
  UseCase --> Store[ConversationRepository (in-memory)]
  UseCase --> AIService
  AIService --> ClientReg[ClientRegistry (by tool)]
  ClientReg --> CodexClient
  ClientReg --> ClaudeCodeClient
```

---

### 3. API 仕様（最小）
- エンドポイント: POST `/ask`
- Request ボディ
```json
{
  "tool": "codex" | "claude",
  "model": "codex:local" | "claude:code-local",  
  "userInput": "この見出しのコントラストを改善したい",
  "designContext": "選択中の2件: ...",
  "conversationId": "省略可（未指定なら新規発行）",
  "options": { "timeoutMs": 120000 }
}
```
- Response ボディ
```json
{
  "content": "提案本文...",
  "conversationId": "サーバ側で維持する会話ID",
  "raw": { "source": "codex-cli" }
}
```

要点:
- 履歴は Figma 側では送らず、サーバ側で `conversationId` 単位に保持し合成します。
- モデル別のプロンプト最適化はサーバ内の `PromptBuilder` に集約します。

---

### 4. コンポーネント設計

#### 4.0 AskUseCase（アプリケーション層）
- 役割: ルーティング層（Hono）からの入力を受け、`PromptBuilder` と会話履歴、`AIService` を調停して応答を生成。ルートに散らばる処理（履歴取得/整形/保存）を集約。
- 入出力:
  - 入力: `{ tool, model, userInput, designContext?, conversationId?, options? }`
  - 出力: `{ content, conversationId, raw }`
- 例（概念コード）
```ts
export class AskUseCase {
  constructor(
    private readonly aiService: AIService,
    private readonly promptBuilders: PromptBuilderRegistry,
    private readonly conversations: ConversationRepository,
    private readonly maxHistory: number = 50,
  ) {}

  async execute(input: {
    tool: 'codex'|'claude';
    model: string;
    userInput: string;
    designContext?: string;
    conversationId?: string;
    options?: { timeoutMs?: number };
  }) {
    const { id, history } = await this.conversations.getOrCreate(input.conversationId);

    const messages = this.promptBuilders
      .resolve(input.tool)
      .withDesignContext(input.designContext)
      .withHistory(history)
      .withUser(input.userInput)
      .build();

    const result = await this.aiService.chat(input.tool, messages, input.options);

    await this.conversations.append(
      id,
      { role: 'user', content: input.userInput },
      { role: 'assistant', content: result.content },
    );
    await this.conversations.trim(id, this.maxHistory);

    return { content: result.content, conversationId: id, raw: result.raw };
  }
}
```

#### 4.1 PromptBuilder（モデル別ビルダー）
- 役割: Figma の `designContext` と現在の会話履歴、ユーザー入力から、モデルに渡すメッセージ配列を構築。
- 切替: ツール（`tool`）に基づき、`CodexPromptBuilder` または `ClaudePromptBuilder` を選択。

```ts
// 共通型
export type ChatMessage = { role: 'system'|'user'|'assistant'; content: string };

export interface PromptBuilder {
  withDesignContext(text?: string): this;
  withHistory(history?: ChatMessage[]): this;
  withUser(input: string): this;
  build(): ChatMessage[];
}

export class BasePromptBuilder implements PromptBuilder {
  protected messages: ChatMessage[] = [];
  withDesignContext(text?: string) {
    if (text?.trim()) this.messages.push({ role: 'system', content: `【Figma構成】\n${text}` });
    return this;
  }
  withHistory(history?: ChatMessage[]) {
    if (history?.length) this.messages.push(...history);
    return this;
  }
  withUser(input: string) {
    this.messages.push({ role: 'user', content: input });
    return this;
  }
  build() { return this.messages; }
}

export class CodexPromptBuilder extends BasePromptBuilder {
  constructor() {
    super();
    this.messages.unshift({
      role: 'system',
      content: 'あなたはFigmaのUI/UXデザイナーです。簡潔かつ実践的に提案してください。'
    });
  }
}

export class ClaudePromptBuilder extends BasePromptBuilder {
  constructor() {
    super();
    this.messages.unshift({
      role: 'system',
      content: 'あなたはUI/UXパートナー。箇条書きで「改善→理由→次アクション」を簡潔に出力。'
    });
  }
}

export class PromptBuilderRegistry {
  resolve(tool: 'codex'|'claude'): PromptBuilder {
    switch (tool) {
      case 'codex': return new CodexPromptBuilder();
      case 'claude': return new ClaudePromptBuilder();
    }
  }
}
```

#### 4.2 Client（実行クライアント）
- 役割: 構築済みメッセージを、各ツールの実行方法（CLI/HTTP）で送信し、テキスト応答を返す。
- 切替: ツール（`tool`）で `CodexClient` / `ClaudeCodeClient` を選択。

```ts
export abstract class BaseClient {
  abstract supports(tool: 'codex'|'claude'): boolean;
  abstract chat(messages: ChatMessage[], options?: Record<string, unknown>): Promise<{ content: string; raw?: any }>;
}

export class CodexClient extends BaseClient {
  supports(tool: 'codex'|'claude') { return tool === 'codex'; }
  async chat(messages: ChatMessage[], options?: any) {
    const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    const out = await runCodex(prompt, options?.timeoutMs);
    return { content: out, raw: { source: 'codex-cli' } };
  }
}

export class ClaudeCodeClient extends BaseClient {
  supports(tool: 'codex'|'claude') { return tool === 'claude'; }
  async chat(messages: ChatMessage[], options?: any) {
    const prompt = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    const out = await runClaudeCodeLocal(prompt, options?.timeoutMs);
    return { content: out, raw: { source: 'claude-code-local' } };
  }
}

export class ClientRegistry {
  constructor(private readonly clients: BaseClient[]) {}
  resolve(tool: 'codex'|'claude'): BaseClient {
    const c = this.clients.find(c => c.supports(tool));
    if (!c) throw new Error(`No client for tool: ${tool}`);
    return c;
  }
}

export class AIService {
  constructor(private readonly registry: ClientRegistry) {}
  async chat(tool: 'codex'|'claude', messages: ChatMessage[], options?: Record<string, unknown>) {
    return this.registry.resolve(tool).chat(messages, options);
  }
}
```

- ランナー実装の指針
  - Codex: 既存の `runCodex(prompt, timeoutMs)` を流用（child_process.spawn）。
  - Claude Code: ローカル CLI か HTTP のどちらかに統一。まずは CLI を想定（後で HTTP に差し替え可）。

#### 4.3 会話履歴（Repository 抽象／InMemory 実装）
- Figma から履歴は送らない。サーバで `conversationId` に紐づけて保持。
- 初期は `InMemoryConversationRepository` のみを採用（SQLite は将来）。
- 上限（例: 50件）と TTL（例: 30分）で `purgeExpired` を定期実行。

```ts
// server/conversationRepository.ts
export type Role = 'system'|'user'|'assistant';
export type ChatMessage = { role: Role; content: string };

export interface ConversationRepository {
  getOrCreate(conversationId?: string): Promise<{ id: string; history: ChatMessage[] }>;
  append(conversationId: string, ...messages: ChatMessage[]): Promise<void>;
  trim(conversationId: string, max: number): Promise<void>;
  touch(conversationId: string): Promise<void>;
  purgeExpired(ttlMs: number): Promise<number>;
}

export class InMemoryConversationRepository implements ConversationRepository {
  private readonly store = new Map<string, { history: ChatMessage[]; updatedAt: number }>();
  async getOrCreate(conversationId?: string) {
    const id = conversationId ?? crypto.randomUUID();
    const now = Date.now();
    const entry = this.store.get(id) ?? { history: [], updatedAt: now };
    entry.updatedAt = now;
    this.store.set(id, entry);
    return { id, history: entry.history };
  }
  async append(id: string, ...messages: ChatMessage[]) {
    const e = this.store.get(id); if (!e) return;
    e.history = [...e.history, ...messages];
    e.updatedAt = Date.now();
  }
  async trim(id: string, max: number) {
    const e = this.store.get(id); if (!e) return;
    e.history = e.history.slice(-max);
  }
  async touch(id: string) {
    const e = this.store.get(id); if (!e) return;
    e.updatedAt = Date.now();
  }
  async purgeExpired(ttlMs: number) {
    const now = Date.now();
    let deleted = 0;
    for (const [cid, e] of this.store) {
      if (now - e.updatedAt > ttlMs) { this.store.delete(cid); deleted++; }
    }
    return deleted;
  }
}
```

- ルート利用（例）
```ts
// DI 構成（初期は Codex のみ）
const repo = new InMemoryConversationRepository();
const aiService = new AIService(new ClientRegistry([ new CodexClient() ]));
const pbRegistry = new PromptBuilderRegistry();
const useCase = new AskUseCase(aiService, pbRegistry, repo, 50);

app.post('/ask', async (c) => {
  const body = await c.req.json<{
    tool: 'codex'|'claude';
    model: string;
    userInput: string;
    designContext?: string;
    conversationId?: string;
    options?: Record<string, unknown>;
  }>();

  const response = await useCase.execute(body);
  return c.json(response);
});
```

---

### 5. ルーティング（Hono）

```ts
// 起動時の依存構成（初期は Codex のみ）
const aiService = new AIService(new ClientRegistry([ new CodexClient() ]));
const pbRegistry = new PromptBuilderRegistry();
const repo = new InMemoryConversationRepository();
const useCase = new AskUseCase(aiService, pbRegistry, repo, 50);

// POST /ask
// body: { tool, model, userInput, designContext?, conversationId?, options? }
app.post('/ask', async (c) => {
  const body = await c.req.json<{
    tool: 'codex'|'claude';
    model: string;
    userInput: string;
    designContext?: string;
    conversationId?: string;
    options?: Record<string, unknown>;
  }>();

  const response = await useCase.execute(body);
  return c.json(response);
});
```

補足:
- エンドポイントは `/ask` に統一。
- ルートは UseCase に委譲し、副作用（履歴保存）は UseCase 内に閉じ込める。

---

### 6. Figma 側（UI/送信ペイロード）
- 追加 UI: セレクト2つ
  - ツール: `codex`/`claude`
  - モデル: ツールごとの固定選択（初期はハードコード。将来は `/v1/providers` で取得）
- 送信例
```json
{
  "tool": "codex",
  "model": "codex:local",
  "userInput": "見出しとボタンの改善ポイントは？",
  "designContext": "選択中の2件: ...",
  "conversationId": "初回は省略可"
}
```

---

### 7. スケーラビリティ/保守性/セキュリティ（ローカル前提）
- スケーラビリティ: 子プロセス同時実行を p-limit 等で制御（同時2-3）。タイムアウト（既存）維持。
- 保守性: Provider（Client）追加/差し替えは `ClientRegistry` に追加するだけ。Prompt 調整はモデル別ビルダーに閉じ込める。
- セキュリティ: 127.0.0.1 バインド、CORS はワイド許可でも可。認証不要。ログはプロンプト全文を避ける。

---

### 8. 実装優先度
- P0
  - POST `/ask` を採用（既存 `/ask` の契約を本設計に合わせて拡張）
  - `AskUseCase`（Application 層）の新設と、ルートからの委譲
  - `PromptBuilder`（Codex/Claude）と `PromptBuilderRegistry`
  - `BaseClient`/`ClientRegistry`/`AIService`、`CodexClient` 実装、`ClaudeCodeClient` 追加
  - 会話履歴（メモリ）と `conversationId` 運用
- P1
  - 子プロセス同時実行の制御、簡易メトリクス
  - Figma UI にツール/モデルセレクトを追加
- P2
  - `/v1/providers` でツール→モデル一覧を配信
  - Claude 側の HTTP ランナー対応（必要に応じて差し替え）

---

### 9. 変更影響
- Figma 側: 送信ペイロードに `tool`, `model`, `userInput`, `conversationId?` を追加。履歴送信は不要化。
- サーバ側: 既存の Codex 実行ロジック（`runCodex`）は `CodexClient` から呼び出すよう移設。

---

以上。最小のファイル追加で、Codex/Claude の二択と将来拡張に耐える骨格を実現します。
