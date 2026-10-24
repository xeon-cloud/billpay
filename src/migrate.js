const { createPool, waitForDb, migrate } = require('./db');

(async () => {
  const pool = createPool();
  try {
    await waitForDb(pool);
    const applied = await migrate(pool);
    console.log(applied.length ? `[billpay] применено миграций: ${applied.length}` : '[billpay] схема актуальна, новых миграций нет');
  } catch (e) {
    console.error('[billpay] ошибка миграции:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
