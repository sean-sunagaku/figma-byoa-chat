import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { createApp } from './app';
import { AskUseCase } from './ask-use-case';
import { AIService } from './ai-service';
import { ClientRegistry } from './client-registry';
import { PromptBuilderRegistry } from './prompt-builder';
import { InMemoryConversationRepository } from './conversation-repository';
import type { ServerConfig } from './env';
import { CodexClient } from './clients/codex-client';
import { ClaudeStubClient } from './clients/claude-client';
import { createCodexRunner } from './run-codex';

export const createHttpServer = (config: ServerConfig) => {
  const conversationRepository = new InMemoryConversationRepository();
  const clientRegistry = new ClientRegistry([
    new CodexClient(createCodexRunner(config.codexCommand)),
    new ClaudeStubClient(),
  ]);
  const aiService = new AIService(clientRegistry);
  const promptBuilderRegistry = new PromptBuilderRegistry();
  const askUseCase = new AskUseCase(
    aiService,
    promptBuilderRegistry,
    conversationRepository,
    config.maxHistory,
  );

  const askApp = createApp({ askUseCase });

  const app = new Hono();

  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: false,
    maxAge: 86400,
  }));

  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    const method = c.req.method;
    const url = c.req.url;
    const userAgent = c.req.header('User-Agent');

    console.log(`🚀 [${new Date().toISOString()}] ${method} ${url}`);
    console.log(`   Origin: ${origin ?? 'null'}`);
    console.log(`   User-Agent: ${userAgent ?? 'unknown'}`);

    try {
      await next();
      console.log(`✅ [${new Date().toISOString()}] ${method} ${url} - Success`);
    } catch (error) {
      console.error(`❌ [${new Date().toISOString()}] ${method} ${url} - Error:`, error);
      throw error;
    }
  });

  app.options('*', (c) => {
    const origin = c.req.header('Origin');
    console.log(`[OPTIONS] Preflight request from origin: ${origin ?? 'null'}`);

    return c.text('', 200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
  });

  app.get('/healthz', (c) => {
    const origin = c.req.header('Origin');

    return c.json({
      status: 'ok',
      cors: {
        origin: origin ?? 'unknown',
        allowed: true,
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.route('/', askApp);

  return { app };
};
