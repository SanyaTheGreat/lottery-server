import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'http://127.0.0.1:59999';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-test-key';
const { supabase } = await import('../src/services/supabaseClient.js');
const { default: router } = await import('../src/routes/game2048.js');

const handler = router.stack.find(layer => layer.route?.path === '/run/start').route.stack[0].handle;

async function requestStart(active = []) {
  const now = Date.now();
  const period = { id: 'current-week', start_at: new Date(now - 86400000).toISOString(), end_at: new Date(now + 86400000).toISOString(), freeze_at: new Date(now + 86300000).toISOString(), status: 'active' };
  const user = { id: 'user-id', telegram_id: 123456789, daily_attempts_remaining: 0, daily_plays_used: 999, referral_attempts_balance: 0 };
  const writes = [];
  const oldFrom = supabase.from;
  supabase.from = table => {
    const filters = [];
    let inserted;
    const query = {
      select() { return this; }, order() { return this; }, limit() { return this; },
      eq(field, value) { filters.push(row => row[field] === value); return this; },
      in(field, values) { filters.push(row => values.includes(row[field])); return this; },
      lte(field, value) { filters.push(row => Date.parse(row[field]) <= Date.parse(value)); return this; },
      gt(field, value) { filters.push(row => Date.parse(row[field]) > Date.parse(value)); return this; },
      insert(row) { inserted = { id: 'new-run', ...row }; writes.push({ table, row }); return this; },
      update() { throw new Error('Starting a game must not debit attempts'); },
      async maybeSingle() { return { data: table === 'users' ? user : [period].find(row => filters.every(f => f(row))), error: null }; },
      async single() { return { data: inserted, error: null }; },
      then(resolve, reject) { return Promise.resolve({ data: active.filter(row => filters.every(f => f(row))), error: null }).then(resolve, reject); },
    };
    return query;
  };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  try {
    await handler({ user: { telegram_id: user.telegram_id } }, res);
    return { res, writes };
  } finally { supabase.from = oldFrom; }
}

test('starts a new game with zero attempts and more than 20 daily plays', async () => {
  const { res, writes } = await requestStart();
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.mode, 'new');
  assert.deepEqual(res.body.attempts, { unlimited: true });
  assert.equal(res.body.run.undo_used_count, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].table, 'game_runs');
  assert.equal(writes[0].row.audit_action.type, 'start');
  assert.ok(writes[0].row.audit_action.request_id);
});

test('resumes the active game without consuming attempts or creating another run', async () => {
  const { res, writes } = await requestStart([{ id: 'existing', user_id: 'user-id', period_id: 'current-week', status: 'active' }]);
  assert.equal(res.body.mode, 'resume');
  assert.equal(res.body.run.id, 'existing');
  assert.equal(writes.length, 0);
});

test('does not resume a game from an expired week', async () => {
  const { res, writes } = await requestStart([{ id: 'old', user_id: 'user-id', period_id: 'expired-week', status: 'active' }]);
  assert.equal(res.body.mode, 'new');
  assert.equal(writes.length, 1);
});
