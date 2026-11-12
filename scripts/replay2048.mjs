import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { verifyGameJournal, SNAPSHOT_FIELDS } from '../src/services/game2048Replay.js';

dotenv.config();
const runId = process.argv[2];
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId || '')) {
  console.error('Usage: node scripts/replay2048.mjs <run-uuid>');
  process.exitCode = 1;
} else {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing server database settings');
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    // Fix an upper bound so a currently active run cannot cause endless pagination.
    const { data: latest, error: headError } = await client.from('game_run_events').select('id').eq('run_id', runId).order('id', { ascending: false }).limit(1).maybeSingle();
    if (headError) throw new Error('Cannot read the journal. Apply the SQL migration first.');
    const events = [];
    if (latest) {
      let cursor = '0';
      while (true) {
        const { data, error } = await client.from('game_run_events').select('*').eq('run_id', runId).gt('id', cursor).lte('id', latest.id).order('id', { ascending: true }).limit(1000);
        if (error) throw new Error('Cannot read journal page: ' + error.code);
        events.push(...data);
        if (data.length < 1000) break;
        cursor = data.at(-1).id;
      }
    }
    // For active runs report the captured range; current state may advance meanwhile.
    const { data: run, error: runError } = await client.from('game_runs').select(SNAPSHOT_FIELDS.join(',')).eq('id', runId).maybeSingle();
    if (runError) throw new Error('Cannot read run: ' + runError.code);
    const current = run?.status === 'finished' ? run : null;
    const report = verifyGameJournal(events, current);
    console.log(JSON.stringify({ run_id: runId, ...report, scope: current ? 'finished_run' : 'captured_journal', payments_verified: false, proves_human_play: false }, null, 2));
    if (report.status === 'failed') process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
