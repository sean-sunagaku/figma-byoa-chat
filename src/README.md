# 🎨 Figma × ローカル Codex CLI チャット連携 実装ガイド（Hono + TypeScript 版）

Figma プラグインからローカルで動作する Codex CLI（ヘッドレスモード）に接続し、UI/UX の改善や配色提案をチャット形式で得るための完全ガイドです。バックエンドを **Hono + TypeScript** で実装し、Figma プラグインと連携する一連の手順・コードをまとめています。

---

## 0. React + Create Figma Plugin へのリプレイス（NEW）

- プラグインのメインスレッドは `src/main.ts`、UI は React + CSS Modules で実装した `src/ui.tsx` に移行しました。`@create-figma-plugin/utilities` の `showUI / emit / on` を使い、`SUBMIT_QUERY` / `SDK_CHANGED` / `CODEX_RESPONSE` / `PLUGIN_ERROR` イベントで状態を同期します。
- `npm run build` / `npm run watch` は `build-figma-plugin` CLI を呼び出し、`src/build` 配下のバンドルと `src/manifest.json` を自動生成します。Figma には生成済みマニフェストを指定するだけで React UI が読み込まれます。
- React の `jsx-runtime` は `preact` にエイリアスしているため、軽量なバンドルサイズのまま React Hooks の書き味で開発できます（設定は `tsconfig.json` と `build-figma-plugin.ui.js`）。
- `src/types.ts` に UI/Main 共有の型を集約し、Codex/Claude 切り替えや履歴送信ロジックを型安全に保っています。

### Create Figma Plugin ツールキットのローカル利用手順

```
$ git clone https://github.com/yuanqing/create-figma-plugin
$ cd create-figma-plugin
$ git checkout --track origin/next
$ npm install
$ npm run build

# 本リポジトリ (my-project) と並べて配置し、ローカルビルドへ差し替える場合
$ ls -a
create-figma-plugin  my-project
$ sh create-figma-plugin/scripts/symlink.sh create-figma-plugin my-project
```

### プラグイン側のビルド & 実行

```
$ cd my-project/src
$ npm install
$ npm run watch   # manifest.json と build/ を自動出力、Figma ではこの manifest を指定
# リリース用
$ npm run build
```

ビルド済み `src/manifest.json` を Figma の「プラグインを開く」から指定すれば、React ベースのチャット UI が起動します。UI 側では SDK 選択をローカルストレージに保持し、メインスレッドは `buildDesignContext` で選択レイヤーの情報をまとめて Codex/Claude サーバーに送信します。


## 1. 概要とアーキテクチャ

```
┌──────────────────────────────┐
│          Figma Editor        │
│  ┌────────────────────────┐  │
│  │     Figma Plugin       │  │
│  │  ┌──────────────┐      │  │
│  │  │ Chat UI (HTML)│ ⇄   │──┼── fetch() → http://localhost:5000/ask
│  │  └──────────────┘      │  │
│  │  Main code (TypeScript)│  │
│  └────────────────────────┘  │
└──────────────────────────────┘
               ↓
        ┌──────────────────────────┐
        │   Hono API Server        │
        │ (Node.js + Codex CLI)    │
        └──────────────────────────┘
```

- **Figma プラグイン**
  - `ui.html`: チャット UI（会話履歴と送信フォーム）
  - `code.ts`: Figma API と Codex Hono サーバーを仲介するロジック
- **ローカル Codex サーバー**
  - `server/index.ts`: Hono + TypeScript で Codex CLI を HTTP 化
  - `codex exec "<prompt>"` をプロセス実行し、レスポンスを返却

---

## 2. 環境セットアップ

```bash
# 依存関係のインストール
npm install

# Figma プラグインの TypeScript をウォッチコンパイル
npm run watch

# Codex Hono サーバーを TypeScript のまま起動（ホットリロードなし）
npm run server:dev
# → 別途ビルドして常時稼働させたい場合
npm run server:build && npm run server:start
```

> **前提**: Codex CLI がローカルで動作しており、`codex exec "..."` が利用可能であること。

---

## 3. Hono + TypeScript サーバー（`server/index.ts`）

ローカルで Codex CLI を呼び出す HTTP API。CORS 設定で Figma iframe（null origin）からのアクセスを許可しています。

```ts
import { spawn } from 'node:child_process';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';

type ConversationTurn = { role: 'user' | 'assistant' | 'system'; content: string };

type AskRequestBody = {
  prompt?: string;
  history?: ConversationTurn[];
};

const app = new Hono();
app.use('*', cors());

app.get('/healthz', (c) => c.json({ status: 'ok' }));

app.post('/ask', async (c) => {
  let request: AskRequestBody;
  try {
    request = await c.req.json<AskRequestBody>();
  } catch (error) {
    console.error('[CodexServer] JSON parse error:', error);
    return c.json({ error: 'リクエストボディのJSON解析に失敗しました。' }, 400);
  }

  const prompt = request.prompt?.trim();
  if (!prompt) return c.json({ error: 'prompt が空です。' }, 400);

  const combinedPrompt = buildPrompt(prompt, request.history ?? []);

  try {
    const output = await runCodex(combinedPrompt);
    return c.text(output);
  } catch (error) {
    console.error('[CodexServer] Codex CLI error:', error);
    const message = error instanceof Error ? error.message : 'Codex CLI 実行時にエラーが発生しました。';
    return c.json({ error: message }, 500);
  }
});

const port = Number(process.env.PORT ?? 5000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`✅ Codex Hono サーバーを起動しました (http://localhost:${port})`);
});

function buildPrompt(prompt: string, history: ConversationTurn[]): string {
  if (history.length === 0) return prompt;
  const formatted = history.map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`).join('\n');
  return `${formatted}\nUSER: ${prompt}`;
}

function runCodex(prompt: string, timeoutMs = 120_000): Promise<string> {
  const command = process.env.CODEX_CMD ?? 'codex';

  return new Promise((resolve, reject) => {
    const child = spawn(command, ['exec', prompt], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Codex CLI の応答がタイムアウトしました。'));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        const message = stderr.trim() || `Codex CLI exited with code ${code}`;
        reject(new Error(message));
      }
    });
  });
}
```

---

## 4. Figma プラグイン設定（`manifest.json`）

```json
{
  "name": "Codex Design Chat",
  "id": "1563837687656471019",
  "api": "1.0.0",
  "main": "code.js",
  "capabilities": [],
  "enableProposedApi": false,
  "documentAccess": "dynamic-page",
  "editorType": ["figma"],
  "ui": "ui.html",
  "networkAccess": {
    "allowedDomains": ["localhost", "127.0.0.1"],
    "reasoning": "ローカルのCodex Honoサーバーと通信するため"
  }
}
```

---

## 5. チャット UI（`ui.html`）

Figma プラグインの iframe 内で動作するチャット UI。選択内容と会話履歴を保持し、Codex への問い合わせ中はボタンを無効化します。

```html
<div id="chat">
  <div class="title">Codex Design Chat</div>
  <div id="messages"></div>
  <div class="status" id="status"></div>
  <form id="composer">
    <input id="input" type="text" placeholder="Codexに相談する内容を入力..." />
    <button id="send" type="submit">送信</button>
  </form>
</div>

<script>
  const messages = document.getElementById('messages');
  const input = document.getElementById('input');
  const statusEl = document.getElementById('status');
  const history = [];

  function append(role, text) {
    const bubble = document.createElement('div');
    bubble.className = `bubble ${role}`;
    bubble.textContent = text;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
  }

  function setSending(isSending) {
    input.disabled = isSending;
    document.getElementById('send').disabled = isSending;
    statusEl.textContent = isSending ? 'Codexに問い合わせ中...' : '';
  }

  document.getElementById('composer').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const value = input.value.trim();
    if (!value) return;

    append('user', value);
    history.push({ role: 'user', content: value });
    parent.postMessage({ pluginMessage: { type: 'userQuery', text: value, history } }, '*');
    input.value = '';
    setSending(true);
  });

  window.addEventListener('message', (event) => {
    const message = event.data.pluginMessage;
    if (!message) return;

    if (message.type === 'codexResponse') {
      append('assistant', message.text);
      history.push({ role: 'assistant', content: message.text });
      setSending(false);
    }

    if (message.type === 'error') {
      append('assistant', message.text);
      setSending(false);
    }
  });
</script>
```

※ 実際のファイルではスタイルや細かい補助処理も含めています。

---

## 6. プラグイン本体（`code.ts`）

- 選択中レイヤーまたはページ全体の情報を収集
- プロンプトに Figma 構成 + ユーザー質問をまとめる
- Codex からの返答を UI に返送

```ts
const CODEX_ENDPOINT = 'http://localhost:5000/ask';

figma.showUI(__html__, { width: 420, height: 520 });

figma.ui.onmessage = async (msg) => {
  if (msg.type !== 'userQuery') return;

  const designContext = buildDesignContext();
  const prompt = createPrompt(msg.text, designContext);

  const body = {
    prompt,
    history: [
      {
        role: 'system',
        content:
          'あなたはFigmaのUI/UXデザイナーです。デザインの改善提案と配色アドバイスを、簡潔かつ実践的に返答してください。',
      },
      ...(msg.history ?? []),
    ],
  };

  try {
    const response = await fetch(CODEX_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Codexサーバーエラー: ${response.status} ${text}`);
    }

    const answer = await response.text();
    figma.ui.postMessage({ type: 'codexResponse', text: answer.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Codexサーバーへのリクエストに失敗しました。';
    figma.ui.postMessage({ type: 'error', text: `⚠️ ${message}` });
  }
};
```

### デザイン情報抽出のサマリ

- ノード名・種類・サイズ（幅×高さ）
- 塗り（SOLID の場合は HEX + 不透明度）
- テキストノードの文字列とフォントサイズ
- 子ノードは最大 5 件まで列挙し、続きがあれば省略表示

---

## 7. プロンプト構成例

```
あなたはFigmaデザインのUI/UX専門家です。
以下の情報を踏まえて、自然な日本語で改善案を回答してください。

【Figmaデザインの構成】
Frame「Header」 1440×100 塗り:#FFFFFF
Frame「LoginForm」 400×300 塗り:#1976d2
  - TEXT「ログイン」18px

【ユーザーからの質問】
「コントラストが弱いですが、改善するには？」
```

Codex 返答例:

> ボタン背景が #1976D2、文字が白の場合、コントラスト比が低くなります。文字色を濃いネイビーに変更するか、ボタン色を暗く調整してコントラスト比 4.5:1 以上を目指しましょう。

---

## 8. テストと動作確認フロー

1. `npm run server:dev` で Hono サーバーを起動
2. `npm run watch` で `code.ts` → `code.js` を自動コンパイル
3. Figma デスクトップアプリでプラグインを実行
   - Resources → Plugins → Development → 本プラグインを選択
4. プラグイン UI からメッセージ送信
   - ローカル Codex CLI が返答し、UI に表示されれば成功

> Codex CLI が起動していない場合はエラーメッセージが表示されます。

---

## 9. 今後の拡張アイデア

- 🔄 **会話履歴の永続化**: Hono サーバー側でセッション管理し、長期的な会話文脈を維持
- ✨ **提案の自動反映**: Codex が提案した配色やサイズを Figma API 経由で適用するアクションボタンを追加
- 🧩 **MCP 連携**: Codex から直接 Figma API を叩く機能を組み込み、デザイン操作を自動化
- 🎨 **カラースウォッチ プレビュー**: 返答内の HEX を検知し、UI に色のプレビューを表示

---

この README とソースをコピーすれば、Hono ベースのローカル Codex サーバーと連動した **Figma デザイン AI アシスタント** が完成します。カスタマイズしてチームのワークフローに組み込みましょう！
