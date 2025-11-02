import { Hono } from 'hono';
import type { AskUseCase, AskUseCaseInput } from './ask-use-case';
import { UnsupportedToolError } from './errors';
import type { SupportedTool } from './client-registry';

type AskUseCasePort = { execute: AskUseCase['execute'] };

type AppDependencies = {
  askUseCase: AskUseCasePort;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isSupportedTool = (value: unknown): value is SupportedTool =>
  value === 'codex' || value === 'claude';

const parseOptions = (value: unknown): { timeoutMs?: number } | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const result: { timeoutMs?: number } = {};
  if ('timeoutMs' in value && typeof value.timeoutMs === 'number') {
    result.timeoutMs = value.timeoutMs;
  }

  return Object.keys(result).length > 0 ? result : undefined;
};

export const createApp = ({ askUseCase }: AppDependencies) => {
  const app = new Hono();

  app.post('/ask', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch (error) {
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Failed to parse request body as JSON.',
          },
        },
        400,
      );
    }

    if (!isRecord(body)) {
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: 'Request body must be a JSON object.',
          },
        },
        400,
      );
    }

    const { tool, model, userInput, designContext, conversationId, options } = body;

    if (!isSupportedTool(tool)) {
      const message = new UnsupportedToolError(String(tool ?? '')).message;
      return c.json({ error: { code: 'UNSUPPORTED_TOOL', message } }, 400);
    }

    if (typeof model !== 'string' || model.length === 0) {
      return c.json(
        {
          error: { code: 'INVALID_REQUEST', message: '`model` is required.' },
        },
        400,
      );
    }

    if (typeof userInput !== 'string' || userInput.trim().length === 0) {
      return c.json(
        {
          error: { code: 'INVALID_REQUEST', message: '`userInput` is required.' },
        },
        400,
      );
    }

    const payload: AskUseCaseInput = {
      tool,
      model,
      userInput,
      designContext: typeof designContext === 'string' ? designContext : undefined,
      conversationId:
        typeof conversationId === 'string' && conversationId.length > 0
          ? conversationId
          : undefined,
      options: parseOptions(options),
    };

    try {
      const result = await askUseCase.execute(payload);
      return c.json(result, 200);
    } catch (error) {
      if (error instanceof UnsupportedToolError) {
        return c.json(
          {
            error: {
              code: 'UNSUPPORTED_TOOL',
              message: error.message,
            },
          },
          400,
        );
      }

      const message = error instanceof Error ? error.message : 'unexpected error';
      console.error('[POST /ask] unexpected error', error);
      return c.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message,
          },
        },
        500,
      );
    }
  });

  return app;
};
