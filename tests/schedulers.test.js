import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const start = app.indexOf('async function startSchedulers()');
const end = app.indexOf('\n}\n', start) + 2;
const source = app.slice(start, end).replace(/await import\(([^)]+)\)/g, 'imports.push($1)');
async function importsFor(env) {
  const imports = [];
  const fn = vm.runInNewContext('(' + source + ')', { process: { env }, imports });
  await fn();
  return imports;
}

test('weekly rollover runs in production even when legacy schedulers are disabled', async () => {
  assert.deepEqual(await importsFor({ NODE_ENV: 'production', ENABLE_SCHEDULERS: 'false' }), ['./scheduler/game2048Finalizer.js']);
});

test('2048-only production never starts legacy notification jobs', async () => {
  assert.deepEqual(await importsFor({ NODE_ENV: 'production', ENABLE_SCHEDULERS: 'true', LUDO_ENABLED: 'false', FREE_SPIN_NOTIFICATIONS_ENABLED: 'true' }), ['./scheduler/game2048Finalizer.js']);
});

test('legacy reminders stay off by default even with legacy games enabled', async () => {
  const imports = await importsFor({ NODE_ENV: 'production', ENABLE_SCHEDULERS: 'true', LUDO_ENABLED: 'true' });
  assert.ok(!imports.some(name => /notifier/i.test(name)));
});

test('local and explicitly disabled production finalizers do not start', async () => {
  assert.deepEqual(await importsFor({}), []);
  assert.deepEqual(await importsFor({ NODE_ENV: 'production', GAME2048_FINALIZER_ENABLED: 'false' }), []);
});
