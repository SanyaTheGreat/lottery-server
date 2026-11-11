import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'http://127.0.0.1:59999';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-test-key';
const { createWeeklyPeriodService } = await import('../src/services/weeklyPeriodService.js');

const now = new Date('2026-11-11T12:00:00Z');
const expired = { id: 'previous', status: 'active', start_at: '2026-11-02T00:00:00Z', end_at: '2026-11-09T00:00:00Z' };
const current = { id: 'current', status: 'active', start_at: '2026-11-09T00:00:00Z', end_at: '2026-11-16T00:00:00Z' };

function fakeDatabase(rows, error = null) {
  const state = { rows, rollovers: 0 };
  const client = {
    from(table) {
      assert.equal(table, 'weekly_periods');
      const filters = [];
      const query = {
        select() { return this; }, order() { return this; }, limit() { return this; },
        in(field, values) { filters.push(row => values.includes(row[field])); return this; },
        lte(field, value) { filters.push(row => Date.parse(row[field]) <= Date.parse(value)); return this; },
        gt(field, value) { filters.push(row => Date.parse(row[field]) > Date.parse(value)); return this; },
        async maybeSingle() { return { data: state.rows.find(row => filters.every(f => f(row))) ?? null, error: null }; },
      };
      return query;
    },
    async rpc(name) {
      assert.equal(name, 'ffg_rollover_weekly_periods');
      state.rollovers++;
      await new Promise(resolve => setTimeout(resolve, 5));
      if (error) return { error: { message: error } };
      state.rows = [current];
      return { data: { ok: true, closed_periods: 1 }, error: null };
    },
  };
  return { state, service: createWeeklyPeriodService(client) };
}

test('uses a current period without invoking rollover', async () => {
  const { state, service } = fakeDatabase([current]);
  assert.equal((await service.getCurrentWeeklyPeriod(now)).id, 'current');
  assert.equal(state.rollovers, 0);
});

test('recovers a period that expired but was left active', async () => {
  const { state, service } = fakeDatabase([expired]);
  assert.equal((await service.getCurrentWeeklyPeriod(now)).id, 'current');
  assert.equal(state.rollovers, 1);
});

test('shares a concurrent rollover between requests', async () => {
  const { state, service } = fakeDatabase([expired]);
  const periods = await Promise.all(Array.from({ length: 8 }, () => service.getCurrentWeeklyPeriod(now)));
  assert.ok(periods.every(p => p.id === 'current'));
  assert.equal(state.rollovers, 1);
});

test('does not return an expired or future leaderboard when rollover fails', async () => {
  const future = { ...current, start_at: '2026-11-16T00:00:00Z', end_at: '2026-11-23T00:00:00Z' };
  const { service } = fakeDatabase([expired, future], 'database unavailable');
  await assert.rejects(service.getCurrentWeeklyPeriod(now), /Weekly rollover failed/);
});

test('includes the start instant, excludes the end instant, and keeps frozen weeks visible', async () => {
  const frozen = fakeDatabase([{ ...current, status: 'frozen' }]);
  assert.equal((await frozen.service.getCurrentWeeklyPeriod(new Date(current.start_at))).id, 'current');
  const ended = fakeDatabase([current], 'expired');
  await assert.rejects(ended.service.getCurrentWeeklyPeriod(new Date(current.end_at)), /Weekly rollover failed/);
});
