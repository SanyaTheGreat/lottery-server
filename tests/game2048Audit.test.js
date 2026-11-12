import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { calculateMove, initStateForNewRun } from '../src/services/game2048Engine.js';
import { makeAuditAction } from '../src/services/game2048Audit.js';
import { verifyGameJournal } from '../src/services/game2048Replay.js';

let db;
const oldRunId = randomUUID();
function newRun(id = randomUUID(), seed = '9223372036854775000') {
  return { id, seed, ...initStateForNewRun(seed), moves: 0, current_score: 0, status: 'active', undo_used_count: 0, undo_available: false, finished_reason: null, finished_at: null, prev_state: null, prev_rng_index: null, prev_moves: null, prev_current_score: null, prev_status: null, prev_finished_reason: null, prev_finished_at: null, audit_action: makeAuditAction('start') };
}
async function insert(run) {
  const keys = Object.keys(run);
  await db.query('insert into game_runs (' + keys.join(',') + ') values (' + keys.map((_,i) => '$' + (i+1)).join(',') + ')', Object.values(run));
}
async function patch(id, data) {
  const keys = Object.keys(data);
  await db.query('update game_runs set ' + keys.map((k,i) => k + '=$' + (i+2)).join(',') + ' where id=$1', [id, ...Object.values(data)]);
}
async function getRun(id) { return (await db.query('select * from game_runs where id=$1', [id])).rows[0]; }
async function events(id) { return (await db.query('select * from game_run_events where run_id=$1 order by id', [id])).rows; }
async function move(run, dir) {
  const next = calculateMove(run, dir);
  if (!next.moved) return run;
  const data = { state: next.state, rng_index: next.rng_index, moves: next.moves, current_score: next.current_score, status: next.status,
    prev_state: run.state, prev_rng_index: run.rng_index, prev_moves: run.moves, prev_current_score: run.current_score, prev_status: run.status, prev_finished_reason: run.finished_reason, prev_finished_at: run.finished_at, undo_available: true,
    audit_action: makeAuditAction('move', { dir, spawn: next.spawn, durov_event: next.durov_event }) };
  if (next.status === 'active') { data.finished_at = null; data.finished_reason = null; }
  await patch(run.id, data);
  return getRun(run.id);
}
async function undo(run) {
  await patch(run.id, { state: run.prev_state, rng_index: run.prev_rng_index, moves: run.prev_moves, current_score: run.prev_current_score, status: run.prev_status, finished_reason: run.prev_finished_reason, finished_at: run.prev_finished_at, undo_available: false, undo_used_count: run.undo_used_count + 1, audit_action: makeAuditAction('undo', { price: run.undo_used_count ? 10 : 0, payment_id: run.undo_used_count ? 123 : null }) });
  return getRun(run.id);
}
before(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec('create table game_runs (id uuid primary key, seed text, state jsonb, rng_index integer, moves integer, current_score integer, status text, undo_used_count integer, undo_available boolean, finished_reason text, finished_at timestamptz, prev_state jsonb, prev_rng_index integer, prev_moves integer, prev_current_score integer, prev_status text, prev_finished_reason text, prev_finished_at timestamptz, updated_at timestamptz)');
  const existing = newRun(oldRunId); delete existing.audit_action;
  await insert(existing);
  const migration = await readFile(new URL('../supabase/migrations/20261113_game_run_events.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration); // Safe to reapply.
});
after(async () => { await db?.close(); });

test('migration leaves old games unchanged and does not invent their history', async () => {
  assert.equal((await events(oldRunId)).length, 0);
  assert.equal((await getRun(oldRunId)).moves, 0);
});
test('journal records and verifies a complete game with Undo and finish', async () => {
  let run = newRun(); await insert(run); run = await getRun(run.id);
  for (let n=0; n<150 && run.status === 'active'; n++) {
    const dir = ['left','up','right','down'].find(d => calculateMove(run,d).moved);
    if (!dir) break;
    run = await move(run, dir);
    if (n === 3 || n === 12) run = await undo(run);
  }
  if (run.status === 'active') { await patch(run.id, { status:'finished', finished_reason:'manual', finished_at:new Date().toISOString(), audit_action:makeAuditAction('finish', {reason:'manual'}) }); run=await getRun(run.id); }
  const journal=await events(run.id), report=verifyGameJournal(journal,run);
  assert.equal(report.status,'verified',JSON.stringify(report));
  assert.equal(report.recorded_undos,2);
  assert.ok(report.recorded_moves > 12);
  assert.equal(journal[0].after_snapshot.seed, '9223372036854775000');
  assert.equal(new Set(journal.map(e=>e.metadata.request_id)).size,journal.length);
  const corrupt=structuredClone(journal); corrupt[5].after_snapshot.current_score+=4;
  assert.equal(verifyGameJournal(corrupt).status,'failed');
  assert.equal(verifyGameJournal(journal.slice(0,-1),run).status,'failed');
});
test('an existing run begins with an explicitly partial checkpoint', async () => {
  let run=await getRun(oldRunId);
  run=await move(run,['left','right','up','down'].find(d=>calculateMove(run,d).moved));
  const journal=await events(run.id);
  assert.equal(journal[0].action,'checkpoint');
  const report=verifyGameJournal(journal,run);
  assert.equal(report.status,'partial'); assert.equal(report.complete,false); assert.equal(report.errors.length,0);
});
test('Durov event and reaching 2048 are replayed from the stored checkpoint', async () => {
  let run=newRun();
  run.state={grid:[[1024,1024,0,0],[2,0,0,0],[0,0,0,0],[0,0,0,0]],durov:{cooldown:0}};
  run.moves=1000; run.current_score=20000; run.rng_index=2400;
  delete run.audit_action;
  // Pick a deterministic seed whose first move triggers Durov.
  for(let seed=1;seed<1000;seed++) { run.seed=String(seed); if(calculateMove(run,'left').durov_event) break; }
  assert.ok(calculateMove(run,'left').durov_event);
  await insert(run); run=await getRun(run.id); run=await move(run,'left');
  const report=verifyGameJournal(await events(run.id),run);
  assert.equal(report.errors.length,0,JSON.stringify(report)); assert.equal(report.status,'partial');
  assert.equal(report.durov_events,1); assert.equal(report.max_tile,2048);
  assert.ok(report.milestones.some(m=>m.tile===2048&&m.move===1001));
  run=await undo(run);
  assert.equal(verifyGameJournal(await events(run.id),run).errors.length,0);
});
test('weekly finalization is logged without reusing stale move metadata', async () => {
  let run=newRun(); await insert(run); run=await getRun(run.id);
  run=await move(run,['left','up','down','right'].find(d=>calculateMove(run,d).moved));
  await patch(run.id,{status:'finished',finished_reason:'period_end'});
  const journal=await events(run.id), last=journal.at(-1);
  assert.equal(last.action,'finish'); assert.equal(last.direction,null); assert.deepEqual(last.metadata,{});
  assert.equal(verifyGameJournal(journal,await getRun(run.id)).status,'verified');
});
test('timestamp-only updates do not create fake game actions', async () => {
  const run=newRun(); await insert(run);
  await patch(run.id,{updated_at:new Date().toISOString()});
  assert.equal((await events(run.id)).length,1);
});
test('anonymous and authenticated clients cannot read or modify the journal', async () => {
  for (const role of ['anon','authenticated']) {
    await db.exec('set role '+role);
    try { await assert.rejects(db.query('select * from game_run_events'),/permission denied/); await assert.rejects(db.query('delete from game_run_events'),/permission denied/); }
    finally { await db.exec('reset role'); }
  }
});
test('service role can read the journal but cannot forge or remove events directly', async () => {
  await db.exec('set role service_role');
  try { assert.ok((await db.query('select * from game_run_events')).rows.length); await assert.rejects(db.query('delete from game_run_events'),/permission denied/); }
  finally { await db.exec('reset role'); }
});
test('journal failure rolls back the game update as well', async () => {
  let run=newRun(); await insert(run); run=await getRun(run.id);
  await db.exec("create function public.test_reject_journal() returns trigger language plpgsql as $$ begin if new.action='move' then raise exception 'test journal failure'; end if; return new; end $$; create trigger test_reject_journal before insert on game_run_events for each row execute function public.test_reject_journal();");
  try {
    const dir=['left','up','right','down'].find(d=>calculateMove(run,d).moved);
    await assert.rejects(move(run,dir),/test journal failure/);
    assert.deepEqual(await getRun(run.id),run); assert.equal((await events(run.id)).length,1);
  } finally { await db.exec('drop trigger test_reject_journal on game_run_events; drop function public.test_reject_journal();'); }
});
