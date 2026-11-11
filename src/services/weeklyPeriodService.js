import { supabase } from './supabaseClient.js';

// Postgres owns week boundaries, final scores and the winners archive.
export function createWeeklyPeriodService(client) {
  let rolloverInFlight = null;

  async function rolloverWeeklyPeriods() {
    if (rolloverInFlight) return rolloverInFlight;
    rolloverInFlight = (async () => {
      const { data, error } = await client.rpc('ffg_rollover_weekly_periods');
      if (error) throw new Error('Weekly rollover failed: ' + error.message);
      if (data?.ok === false) throw new Error('Weekly rollover did not complete');
      return data;
    })();
    try {
      return await rolloverInFlight;
    } finally {
      rolloverInFlight = null;
    }
  }

  async function selectCurrent(now) {
    const iso = now.toISOString();
    const { data, error } = await client.from('weekly_periods')
      .select('id,start_at,freeze_at,end_at,status')
      .in('status', ['active', 'frozen'])
      .lte('start_at', iso)
      .gt('end_at', iso)
      .order('start_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error('Weekly period lookup failed: ' + error.message);
    return data;
  }

  async function getCurrentWeeklyPeriod(now = new Date()) {
    const current = await selectCurrent(now);
    if (current) return current;
    // Recover after a sleeping server or a missed scheduler tick.
    await rolloverWeeklyPeriods();
    const recovered = await selectCurrent(now);
    if (!recovered) throw new Error('No current weekly period after rollover');
    return recovered;
  }

  return { getCurrentWeeklyPeriod, rolloverWeeklyPeriods };
}

export const { getCurrentWeeklyPeriod, rolloverWeeklyPeriods } = createWeeklyPeriodService(supabase);
