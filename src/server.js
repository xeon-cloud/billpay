let config, createPool, createApp;
try {
  config = require('./config');
  ({ createPool } = require('./db'));
  ({ createApp } = require('./app'));
} catch (e) {
  console.error('[billpay] не удалось запустить: ' + e.message);
  process.exit(1);
}

async function main() {
  const pool = createPool();
  const app = await createApp({ pool });
  const server = app.listen(config.port, config.host, () => {
    console.log(`[billpay] http://localhost:${config.port}  ·  API: /api/v1  ·  Swagger: /api/v1/docs  ·  healthz: /healthz`);
  });
  // дольше типичного таймаута reverse proxy
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  let stopping = false;
  const shutdown = (signal) => {
    if (stopping) return;
    stopping = true;
    console.log(`[billpay] ${signal}: завершаю работу…`);
    const force = setTimeout(() => { console.error('[billpay] не успели завершиться за 10 с, выходим принудительно'); process.exit(1); }, 10000);
    force.unref();
    server.close(async () => {
      try { await pool.end(); } catch (e) { console.error(e); }
      console.log('[billpay] остановлено');
      process.exit(0);
    });
    server.closeIdleConnections?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((e) => {
  console.error('[billpay] не удалось запустить:', e.message);
  process.exit(1);
});
