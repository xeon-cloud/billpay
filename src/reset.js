// npm run reset -- --yes: данные стираются, схема и админ из .env остаются
const { createPool, waitForDb, migrate, tx } = require('./db');
const { upsertEnvAdmin } = require('./auth');

async function resetData(pool) {
  await tx(pool, async (c) => {
    await c.query('TRUNCATE reminders, payment_occurrences, recurring_payments, settings RESTART IDENTITY');
    await c.query('DELETE FROM users WHERE NOT is_env_admin');
    // id не переиспользуем: в JWT sub — это id пользователя
    await c.query(`SELECT setval(s, GREATEST((SELECT max(id) FROM users), COALESCE(pg_sequence_last_value(s), 0), 1))
                    FROM (SELECT pg_get_serial_sequence('users', 'id')::regclass AS s) q`);
  });
}

module.exports = { resetData };

if (require.main === module) {
  if (!process.argv.includes('--yes')) {
    console.error('Это удалит ВСЕ данные, кроме главного администратора из .env. Запустите с флагом --yes:\n  npm run reset -- --yes\n  docker compose exec app node src/reset.js --yes');
    process.exit(1);
  }
  (async () => {
    const pool = createPool();
    try {
      await waitForDb(pool);
      await migrate(pool);
      await upsertEnvAdmin(pool);
      await resetData(pool);
      console.log('[billpay] данные удалены; остался только главный администратор из .env');
    } catch (e) {
      console.error('[billpay] очистка не выполнена:', e.message);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  })();
}
