import { supabase } from '../../services/supabaseClient.js';

const getLeaderboardReferrals = async (req, res) => {
  try {
    const { telegram_id, limit = 10, offset = 0 } = req.query;
    const from = Number(offset);
    const to = from + Number(limit) - 1;

    // --- TOP-3 ---
    const { data: top3, error: top3Error } = await supabase
      .from('v_top_referrers_period')
      .select('user_id, telegram_id, username, avatar_url, ref_count, rank')
      .order('rank', { ascending: true })
      .limit(3);
    if (top3Error) throw top3Error;

    // --- Список (пагинация) ---
    const { data: list, error: listError, count } = await supabase
      .from('v_top_referrers_period')
      .select('user_id, telegram_id, username, avatar_url, ref_count, rank', { count: 'exact' })
      .order('rank', { ascending: true })
      .range(from, to);
    if (listError) throw listError;

    // --- Моё место ---
    let me = null;
    if (telegram_id) {
      const { data: meRow, error: meError } = await supabase
        .from('v_top_referrers_period')
        .select('rank, username, avatar_url, ref_count')
        .eq('telegram_id', telegram_id)
        .maybeSingle();
      if (meError) throw meError;
      me = meRow ? { ...meRow, total_spent: meRow.ref_count } : null;
    }

    // --- Призы для топ-3 (если одинаковые, можно оставить spender_place)
    const { data: rawPrizes, error: prizesError } = await supabase
      .from('gifts_for_cases')
      .select('spender_place, nft_name, slug')
      .in('spender_place', [1, 2, 3])
      .order('spender_place', { ascending: true });
    if (prizesError) throw prizesError;

    const prizes = (rawPrizes || []).map(p => ({
      place: p.spender_place,
      nft_name: p.nft_name ?? null,
      slug: p.slug ?? null,
    }));

    // --- Дата окончания сезона
    const { data: settings, error: settingsError } = await supabase
      .from('leaderboard_settings')
      .select('end_at')
      .order('end_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (settingsError) throw settingsError;

    // --- форматируем ответ под фронт
    const listFormatted = (list || []).map(row => ({
      ...row,
      total_spent: row.ref_count,
    }));
    const top3Formatted = (top3 || []).map(row => ({
      ...row,
      total_spent: row.ref_count,
    }));

    res.status(200).json({
      top3: top3Formatted,
      list: listFormatted,
      me,
      total: count ?? listFormatted.length ?? 0,
      prizes,
      end_at: settings?.end_at ?? null,
    });
  } catch (error) {
    console.error('❌ /users/leaderboard-referrals error:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Server error' });
  }
};

export default getLeaderboardReferrals;
