### figma-byoa-chat テスト設計指針（TDD）

- `/ask` のルーティング層でステータスコードとエラーフォーマットを固定し、上位から下位へ順にテストを書き進める。
- 外部 CLI 呼び出しはスタブ化し、会話履歴と例外レスポンスを副作用観測の主対象とする。
- ビルダー・クライアント・リポジトリは個別に単体テストし、`AskUseCase` での連携を結合レベルで保証する。

| ユースケース | 入力 | 期待結果 | 制約・例外 | 副作用 | 参照仕様 |
| --- | --- | --- | --- | --- | --- |
| `/ask` 新規会話 正常系 | `tool=codex`, `model=codex:local`, `userInput`, `designContext`, `conversationId` 省略 | HTTP 200, `content` と新規 `conversationId`, `raw.source="codex-cli"` を返す | `userInput` 必須。`PromptBuilderRegistry.resolve('codex')` 成功が前提 | `ConversationRepository.getOrCreate` が新規 ID を生成、`append`→`trim` を1回ずつ呼ぶ | `3. API 仕様`, `4.0 AskUseCase`, `5. ルーティング` |
| `/ask` 既存会話 正常系 | 既存 `conversationId` と履歴あり | 同一 `conversationId` で返し、過去履歴と今回入力を含むメッセージで AI を呼ぶ | 履歴上限 `maxHistory=50` で古い順に削除 | 履歴にユーザー→アシスタントが追記され `trim` が履歴を絞る | `4.0 AskUseCase`, `4.3 会話履歴` |
| `/ask` バリデーション失敗 | `userInput` 欠落 等 | HTTP 400 + `{"error":{"code":"INVALID_REQUEST","message":"..."}}`、`AskUseCase` 未呼び出し | JSON パース後のバリデーションで打ち切り | なし | `3. API 仕様`, `5. ルーティング` |
| 未対応 `tool` 指定 | `tool="unknown"` | HTTP 400 + `{"error":{"code":"UNSUPPORTED_TOOL","message":"..."}}` | `PromptBuilderRegistry.resolve` が `UnsupportedToolError` を投げ、ルートで捕捉 | なし | `4.1 PromptBuilder`, `5. ルーティング` |
| 内部例外発生 | `AIService.chat` などで例外 | HTTP 500 + `{"error":{"code":"INTERNAL_ERROR","message":"unexpected error"}}` | 例外はログのみで返却本文は固定 | なし | `5. ルーティング` |
| `AskUseCase` で `designContext` 空文字 | `designContext="   "` | AI メッセージにデザイン文脈が含まれない | `withDesignContext` が空文字を無視 | なし | `4.0 AskUseCase`, `4.1 PromptBuilder` |
| `AskUseCase` の `options.timeoutMs` 透過 | `options={timeoutMs:120000}` | `AIService.chat` に同値を渡す | `options` 未指定時は `undefined` | なし | `3. API 仕様`, `4.0 AskUseCase`, `4.2 Client` |
| `PromptBuilderRegistry` 正常切替 | `tool='codex'` / `'claude'` | ツールごとに対応ビルダーを返す | ビルダーは都度新規生成 | なし | `4.1 PromptBuilder` |
| `CodexPromptBuilder` メッセージ構成 | `withDesignContext`→`withHistory`→`withUser` | 先頭に Codex 用システム文、順序通りに要素が並ぶ | 履歴は `ChatMessage[]` をそのまま挿入 | なし | `4.1 PromptBuilder` |
| `ClaudePromptBuilder` メッセージ構成 | 同上 | 先頭のシステム文が Claude 用文面 | Codex との差分を比較 | なし | `4.1 PromptBuilder` |
| `ClientRegistry.resolve` 正常/異常 | 登録済み `clients=[CodexClient]` | `resolve('codex')` が `CodexClient` を返す | 未登録ツールで `Error("No client for tool: ...")` | なし | `4.2 Client` |
| `AIService.chat` 委譲 | `tool='codex'`, `messages`, `options` | `ClientRegistry.resolve` を呼び、返ったクライアントの `chat` を1回だけ呼ぶ | クライアント例外は再送出 | なし | `4.2 Client` |
| `InMemoryConversationRepository.getOrCreate` | `conversationId` 省略/指定 | 省略時は新規 ID 発行、指定時は既存履歴 | `updatedAt` が最新に更新 | Map が更新される | `4.3 会話履歴` |
| `append` 例外 | 未登録 ID に対して `append` | `UnknownConversationError` を投げる | `getOrCreate` 経由でなければ失敗 | なし | `4.3 会話履歴` |
| `append` と `trim` の連携 | 既存履歴に追記後 `trim(max=2)` | 追記を含めつつ最大件数超過分を先頭から削除 | `max` は 0 未満にしない前提 | Map が更新される | `4.3 会話履歴` |
| `purgeExpired` | `ttlMs` 超過/未超過の複数会話 | 有効期限切れのみ削除し削除件数を返す | `ttlMs>0` を想定（<=0 の扱いは要確認） | Map から削除 | `4.3 会話履歴` |
| `touch` | 既存会話で呼び出し | `updatedAt` が更新され履歴は変わらない | 既存 ID 前提 | Map の timestamp 更新 | `4.3 会話履歴` |
