import { supabase } from '../../services/supabaseClient.js';

const DAYS_LOCK = 21;

// helpers
function utcMidnightNextISO(now = new Date()) {
  // ближайшие 00:00 UTC (завтра)
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const next = new Date(Date.UTC(y, m, d + 1, 0, 0, 0, 0));
  return next.toISOString();
}

const getProfile = async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) {
      return res.status(401).json({ error: 'Unauthorized: no telegram_id in token' });
    }

    // 1) user базовый + attempts поля для 2048
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select(`
        id, telegram_id, username, wallet, tickets, payload, avatar_url,
        daily_day_utc, daily_attempts_remaining, daily_plays_used, referral_attempts_balance
      `)
      .eq('telegram_id', telegram_id)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // === дальше можно параллелить ===
    const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

    // 2) referral earnings (как у тебя было)
    const { data: earns, error: earnsErr } = await supabase
      .from('referral_earnings')
      .select('amount, created_at')
      .eq('referrer_id', user.id);

    if (earnsErr) {
      console.error('referral_earnings error:', earnsErr.message);
      return res.status(500).json({ error: 'Failed to load referral earnings' });
    }

    const totalAll = (earns || []).reduce((s, r) => s + toNum(r.amount), 0);

    const cutoff = Date.now() - DAYS_LOCK * 24 * 60 * 60 * 1000;
    const unlockedRaw = (earns || [])
      .filter((r) => new Date(r.created_at).getTime() <= cutoff)
      .reduce((s, r) => s + toNum(r.amount), 0);

    const { data: wds, error: wdErr } = await supabase
      .from('referral_withdrawals')
      .select('amount, status')
      .eq('telegram_id', telegram_id)
      .in('status', ['confirmed', 'sent_needs_manual_fix']);

    if (wdErr) {
      console.error('referral_withdrawals error:', wdErr.message);
      return res.status(500).json({ error: 'Failed to load withdrawals' });
    }

    const withdrawn = (wds || []).reduce((s, r) => s + toNum(r.amount), 0);
    const can = Math.max(0, unlockedRaw - withdrawn);
    const frozen = Math.max(0, totalAll - can - withdrawn);
    const withdraw_available = can >= 3;

    // ====== 2048: active period ======
    const { data: periods, error: pErr } = await supabase
      .from('weekly_periods')
      .select('id,start_at,freeze_at,end_at,status')
      .eq('status', 'active')
      .order('start_at', { ascending: false })
      .limit(1);

    if (pErr) {
      console.error('weekly_periods select error:', pErr.message);
      return res.status(500).json({ error: 'DB error (weekly_periods)' });
    }

    const period = periods?.[0] ?? null;

    // ====== 2048: best_all_time + games_played ======
    // games_played = COUNT(*) всех game_runs пользователя
    const [{ count: gamesCount, error: gCountErr }, { data: bestRows, error: bestErr }] =
      await Promise.all([
        supabase
          .from('game_runs')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id),

        supabase
          .from('game_runs')
          .select('current_score')
          .eq('user_id', user.id)
          .order('current_score', { ascending: false })
          .limit(1),
      ]);

    if (gCountErr) {
      console.error('game_runs count error:', gCountErr.message);
      return res.status(500).json({ error: 'DB error (game_runs count)' });
    }
    if (bestErr) {
      console.error('game_runs best error:', bestErr.message);
      return res.status(500).json({ error: 'DB error (game_runs best)' });
    }

    const best_all_time = Number(bestRows?.[0]?.current_score ?? 0);
    const games_played = Number(gamesCount ?? 0);

    // ====== 2048: weekly best + weekly place (если есть period) ======
    let best_week = 0;
    let week_place = null;

    if (period?.id) {
      const { data: myWeek, error: myWeekErr } = await supabase
        .from('weekly_scores')
        .select('best_score, achieved_at')
        .eq('period_id', period.id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (myWeekErr) {
        console.error('weekly_scores my row error:', myWeekErr.message);
        // не фейлим профиль, просто не покажем rank
      } else if (myWeek) {
        best_week = Number(myWeek.best_score ?? 0);

        // rank = count(higher) + count(same but earlier) + 1
        const { count: higherCount, error: c1Err } = await supabase
          .from('weekly_scores')
          .select('user_id', { count: 'exact', head: true })
          .eq('period_id', period.id)
          .gt('best_score', best_week);

        if (c1Err) {
          console.error('weekly_scores higher count error:', c1Err.message);
        } else {
          let earlierSameCount = 0;

          if (myWeek.achieved_at) {
            const { count: sameEarlier, error: c2Err } = await supabase
              .from('weekly_scores')
              .select('user_id', { count: 'exact', head: true })
              .eq('period_id', period.id)
              .eq('best_score', best_week)
              .lt('achieved_at', myWeek.achieved_at);

            if (c2Err) {
              console.error('weekly_scores same-earlier count error:', c2Err.message);
            } else {
              earlierSameCount = Number(sameEarlier ?? 0);
            }
          }

          week_place = Number(higherCount ?? 0) + earlierSameCount + 1;
        }
      }
    }

    // ====== 2048: attempts ======
    const attempts = {
      daily_attempts_remaining: Number(user.daily_attempts_remaining ?? 0),
      referral_attempts_balance: Number(user.referral_attempts_balance ?? 0),
      daily_plays_used: Number(user.daily_plays_used ?? 0),
      resets_at_utc: utcMidnightNextISO(new Date()),
    };

    return res.status(200).json({
      telegram_id: user.telegram_id,
      username: user.username,
      avatar_url: user.avatar_url,

      // оставляю, вдруг ещё нужно где-то в проекте (профиль “старый” не ломаем)
      wallet: user.wallet,
      tickets: user.tickets,
      payload: user.payload,

      // старая реф-часть
      referral_total: Number(totalAll.toFixed(9)),
      referral_can: Number(can.toFixed(9)),
      referral_frozen: Number(frozen.toFixed(9)),
      withdraw_available,

      // новая 2048 часть
      game2048: {
        best_all_time,
        best_week,
        week_place,
        games_played,
        attempts,
        period: period
          ? {
              id: period.id,
              start_at: period.start_at,
              freeze_at: period.freeze_at,
              end_at: period.end_at,
              status: period.status,
            }
          : null,
      },
    });
  } catch (err) {
    console.error('❌ Error in getProfile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export default getProfile;