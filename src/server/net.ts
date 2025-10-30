import { createServer } from 'node:net';

export const ensurePortAvailable = (portNumber: number, hostName: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const tester = createServer();

    tester.once('error', (error: NodeJS.ErrnoException) => {
      tester.close();

      if (error.code === 'EADDRINUSE') {
        reject(new Error(`ポート ${portNumber} が使用中です。`));
      } else {
        reject(error);
      }
    });

    tester.once('listening', () => {
      tester.close();
      resolve();
    });

    tester.listen(portNumber, hostName);
  });
};
