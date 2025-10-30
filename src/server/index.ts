import { serve } from '@hono/node-server';

import { loadServerConfig } from './env';
import { createHttpServer } from './http-server';
import { ensurePortAvailable } from './net';

const config = loadServerConfig();
const { app } = createHttpServer(config);

bootstrap().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Server] 起動に失敗しました: ${message}`);
  process.exit(1);
});

async function bootstrap(): Promise<void> {
  await ensurePortAvailable(config.port, config.host);

  const server = serve(
    {
      fetch: app.fetch,
      port: config.port,
      hostname: config.host,
    },
    () => {
      console.log(`✅ Ask サーバーを起動しました (http://${config.host}:${config.port})`);
      console.log('   ファイルの変更を検出すると自動で再起動します。');
    },
  );

  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `[Server] ポート ${config.port} は既に使用されています。別プロセスを停止するか、PORT を変更してください。`,
      );
      process.exit(1);
    }

    console.error('[Server] サーバーエラーが発生しました:', error);
  });
}
