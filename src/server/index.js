var _a;
import { spawn } from 'node:child_process';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
const app = new Hono();
app.use('*', cors());
app.get('/healthz', (c) => c.json({ status: 'ok' }));
app.post('/ask', async (c) => {
    var _a, _b;
    let request;
    try {
        request = await c.req.json();
    }
    catch (error) {
        console.error('[CodexServer] JSON parse error:', error);
        return c.json({ error: 'リクエストボディのJSON解析に失敗しました。' }, 400);
    }
    const prompt = (_a = request.prompt) === null || _a === void 0 ? void 0 : _a.trim();
    if (!prompt) {
        return c.json({ error: 'prompt が空です。' }, 400);
    }
    const combinedPrompt = buildPrompt(prompt, (_b = request.history) !== null && _b !== void 0 ? _b : []);
    try {
        const output = await runCodex(combinedPrompt);
        return c.text(output);
    }
    catch (error) {
        console.error('[CodexServer] Codex CLI error:', error);
        return c.json({ error: error instanceof Error ? error.message : 'Codex CLI 実行時にエラーが発生しました。' }, 500);
    }
});
const port = Number((_a = process.env.PORT) !== null && _a !== void 0 ? _a : 5000);
serve({
    fetch: app.fetch,
    port,
}, () => {
    console.log(`✅ Codex Hono サーバーを起動しました (http://localhost:${port})`);
});
function buildPrompt(prompt, history) {
    if (history.length === 0) {
        return prompt;
    }
    const formattedHistory = history
        .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
        .join('\n');
    return `${formattedHistory}\nUSER: ${prompt}`;
}
async function runCodex(prompt, timeoutMs = 120000) {
    var _a;
    const command = (_a = process.env.CODEX_CMD) !== null && _a !== void 0 ? _a : 'codex';
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
            }
            else {
                const message = stderr.trim() || `Codex CLI exited with code ${code}`;
                reject(new Error(message));
            }
        });
    });
}
