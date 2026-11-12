import { isDeepStrictEqual } from 'node:util';
import { calculateMove, initStateForNewRun, GAME2048_ENGINE_VERSION } from './game2048Engine.js';

export const SNAPSHOT_FIELDS = [
  'seed', 'state', 'rng_index', 'moves', 'current_score', 'status',
  'undo_used_count', 'undo_available', 'finished_reason', 'finished_at',
  'prev_state', 'prev_rng_index', 'prev_moves', 'prev_current_score',
  'prev_status', 'prev_finished_reason', 'prev_finished_at',
];
export function auditSnapshot(run) {
  return Object.fromEntries(SNAPSHOT_FIELDS.map(key => [key, key === 'seed' ? String(run[key]) : run[key] ?? null]));
}

// Read-only verification; it never calls the game endpoints or writes to the DB.
export function verifyGameJournal(events, currentRun = null) {
  const errors = [], unverified = [], milestones = [];
  let previous = null, previousId = null, runId = null;
  let moves = 0, undos = 0, durov = 0, highest = 0;
  const check = (condition, event, message) => {
    if (!condition) errors.push({ event_id: event.id, message });
  };
  const equal = (a, b) => isDeepStrictEqual(a, b);
  if (!events.length) return { status: 'partial', complete: false, errors: [], unverified: ['No journal exists for this run'], events: 0 };
  for (let i = 0; i < events.length; i++) {
    const e = events[i], before = e.before_snapshot, after = e.after_snapshot;
    runId ??= e.run_id;
    check(e.run_id === runId, e, 'Mixed run IDs');
    if (previousId !== null) check(BigInt(e.id) > BigInt(previousId), e, 'Events are out of order');
    previousId = e.id;
    if (!after?.state?.grid) { check(false, e, 'Missing after state'); continue; }
    if (previous) check(equal(before, previous), e, 'State gap between events');
    if (!i) {
      check(e.action === 'start' || e.action === 'checkpoint', e, 'Missing initial state');
      check(before === null, e, 'Initial event unexpectedly has a before state');
    }
    const supported = e.engine_version === GAME2048_ENGINE_VERSION;
    if (e.action === 'start') {
      check(i === 0, e, 'Unexpected repeated start');
      if (supported) {
        const init = initStateForNewRun(after.seed);
        check(equal(after.state, init.state) && after.rng_index === init.rng_index && after.moves === 0 && after.current_score === 0 && Number(after.undo_used_count) === 0 && after.status === 'active', e, 'Invalid initial game state');
      } else unverified.push({ event_id: e.id, message: 'Unknown initial engine version' });
    } else if (e.action === 'checkpoint') {
      check(i === 0, e, 'Unexpected checkpoint inside journal');
      unverified.push({ event_id: e.id, message: 'Recording began after the run started' });
    } else if (!before?.state?.grid) {
      check(false, e, 'Missing before state');
    } else if (e.action === 'move') {
      moves++;
      if (!supported || !['up', 'down', 'left', 'right'].includes(e.direction)) {
        unverified.push({ event_id: e.id, message: 'Missing direction or unsupported rules version' });
      } else {
        const next = calculateMove(before, e.direction);
        check(before.status === 'active' && next.moved, e, 'Move from inactive or unchanged state');
        const expected = { ...before, state: next.state, rng_index: next.rng_index, moves: next.moves, current_score: next.current_score, status: next.status, undo_available: true,
          prev_state: before.state, prev_rng_index: before.rng_index, prev_moves: before.moves, prev_current_score: before.current_score, prev_status: before.status, prev_finished_reason: before.finished_reason, prev_finished_at: before.finished_at };
        if (next.status === 'active') { expected.finished_reason = null; expected.finished_at = null; }
        check(equal(after, expected), e, 'Move result differs from server rules');
        check(equal(e.metadata?.spawn, next.spawn), e, 'Spawn metadata differs');
        check(equal(e.metadata?.durov_event, next.durov_event), e, 'Durov metadata differs');
        if (next.durov_event) durov++;
      }
    } else if (e.action === 'undo') {
      undos++;
      check(Boolean(before.undo_available && before.prev_state), e, 'Undo without an available snapshot');
      const expected = { ...before, state: before.prev_state, rng_index: Number(before.prev_rng_index ?? 0), moves: Number(before.prev_moves ?? 0), current_score: Number(before.prev_current_score ?? 0), status: before.prev_status ?? 'active', finished_reason: before.prev_finished_reason ?? null, finished_at: before.prev_finished_at ?? null, undo_available: false, undo_used_count: Number(before.undo_used_count ?? 0) + 1 };
      check(equal(after, expected), e, 'Undo did not restore the saved previous state');
    } else if (e.action === 'finish') {
      check(after.status === 'finished', e, 'Finish did not finish the run');
      const expected = { ...before, status: after.status, finished_reason: after.finished_reason, finished_at: after.finished_at };
      check(equal(after, expected), e, 'Finish unexpectedly changed the board, score or counters');
    } else {
      check(false, e, 'Unexplained game state mutation');
    }
    const max = Math.max(0, ...after.state.grid.flat());
    for (const tile of [1024, 2048, 4096]) {
      if (highest < tile && max >= tile) milestones.push({ tile, move: after.moves, recorded_at: e.recorded_at });
    }
    highest = Math.max(highest, max);
    previous = after;
  }
  if (currentRun && previous) check(equal(previous, auditSnapshot(currentRun)), events.at(-1), 'Last journal state differs from the current database state');
  const complete = events[0].action === 'start';
  return { status: errors.length ? 'failed' : complete && !unverified.length ? 'verified' : 'partial', complete, events: events.length, recorded_moves: moves, recorded_undos: undos, durov_events: durov, max_tile: highest, milestones, first_recorded_at: events[0].recorded_at, last_recorded_at: events.at(-1).recorded_at, final_score: previous?.current_score, errors, unverified };
}
