import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createApp } from '../app';
import type { AskUseCase } from '../ask-use-case';
import { UnsupportedToolError } from '../errors';

// ルーティングレベルでの `/ask` エンドポイント検証。
// Spec refs: TEST_PLAN /ask ルーティング各ケース, DESIGN 5. ルーティング

type AskUseCasePort = { execute: AskUseCase['execute'] };
type JsonObject = Record<string, unknown>;

const buildRequest = (body: unknown) =>
  new Request('http://localhost/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

function assertIsRecord(value: unknown): asserts value is JsonObject {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Response JSON must be an object');
  }
}

const readJson = async (response: Response): Promise<JsonObject> => {
  const payload = await response.json();
  assertIsRecord(payload);
  return payload;
};

describe('POST /ask ルーティング', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('新規会話で HTTP 200 と codex 応答を返す', async () => {
    const execute: jest.MockedFunction<AskUseCase['execute']> = jest.fn(async () => ({
      content: 'AI response',
      conversationId: 'new-id',
      raw: { source: 'codex-cli' },
    }));
    const askUseCase: AskUseCasePort = { execute };

    const app = createApp({ askUseCase });
    const request = buildRequest({
      tool: 'codex',
      model: 'codex:local',
      userInput: 'こんにちは',
      designContext: 'Frame A',
    });

    const response = await app.request(request);
    const json = await readJson(response);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      content: 'AI response',
      conversationId: 'new-id',
      raw: { source: 'codex-cli' },
    });
    expect(execute).toHaveBeenCalledWith({
      tool: 'codex',
      model: 'codex:local',
      userInput: 'こんにちは',
      designContext: 'Frame A',
      conversationId: undefined,
      options: undefined,
    });
  });

  it('既存会話で既存 conversationId を維持する', async () => {
    const execute: jest.MockedFunction<AskUseCase['execute']> = jest.fn(async () => ({
      content: 'RESPONSE',
      conversationId: 'existing-id',
      raw: { source: 'codex-cli' },
    }));
    const askUseCase: AskUseCasePort = { execute };

    const app = createApp({ askUseCase });
    const request = buildRequest({
      tool: 'codex',
      model: 'codex:local',
      userInput: 'follow up',
      designContext: 'Frame B',
      conversationId: 'existing-id',
    });

    const response = await app.request(request);

    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledWith({
      tool: 'codex',
      model: 'codex:local',
      userInput: 'follow up',
      designContext: 'Frame B',
      conversationId: 'existing-id',
      options: undefined,
    });
  });

  it('バリデーション失敗時に HTTP 400 と INVALID_REQUEST エラーを返す', async () => {
    const execute: jest.MockedFunction<AskUseCase['execute']> = jest.fn(async (_input) => ({
      content: '',
      conversationId: '',
      raw: {},
    }));
    const askUseCase: AskUseCasePort = { execute };

    const app = createApp({ askUseCase });
    const request = buildRequest({
      tool: 'codex',
      model: 'codex:local',
      designContext: 'Frame',
    });

    const response = await app.request(request);
    const json = await readJson(response);

    expect(response.status).toBe(400);
    expect(json).toEqual({
      error: {
        code: 'INVALID_REQUEST',
        message: expect.any(String),
      },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('未対応 tool 指定時に HTTP 400 と UNSUPPORTED_TOOL エラーを返す', async () => {
    const execute: jest.MockedFunction<AskUseCase['execute']> = jest.fn(async () => {
      throw new UnsupportedToolError('unknown');
    });
    const askUseCase: AskUseCasePort = { execute };

    const app = createApp({ askUseCase });
    const request = buildRequest({
      tool: 'unknown',
      model: 'codex:local',
      userInput: 'hey',
    });

    const response = await app.request(request);
    const json = await readJson(response);

    expect(response.status).toBe(400);
    expect(json).toEqual({
      error: {
        code: 'UNSUPPORTED_TOOL',
        message: expect.stringContaining('unknown'),
      },
    });
  });

  it('内部例外時に HTTP 500 と INTERNAL_ERROR を返す', async () => {
    const execute: jest.MockedFunction<AskUseCase['execute']> = jest.fn(async () => {
      throw new Error('boom');
    });
    const askUseCase: AskUseCasePort = { execute };

    const app = createApp({ askUseCase });
    const request = buildRequest({
      tool: 'codex',
      model: 'codex:local',
      userInput: 'oops',
    });

    const response = await app.request(request);
    const json = await readJson(response);

    expect(response.status).toBe(500);
    expect(json).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'boom' } });
  });
});
