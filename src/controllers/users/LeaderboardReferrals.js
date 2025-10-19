import { supabase } from '../../services/supabaseClient.js';

export const getLeaderboardReferrals = async (req, res) => {
  try {
    // 🔐 свой рейтинг показываем только по JWT
    const myTelegramId = req.user?.telegram_id || null;

    // безопасная пагинация
    const limitNum = Math.min(Math.max(parseInt(req.query.limit ?? '10', 10), 1), 100);
    const offsetNum = Math.max(parseInt(req.query.offset ?? '0', 10), 0);
    const from = offsetNum;
    const to = from + limitNum - 1;

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

    // --- Моё место (только при токене) ---
    let me = null;
    if (myTelegramId) {
      const { data: meRow, error: meError } = await supabase
        .from('v_top_referrers_period')
        .select('rank, username, avatar_url, ref_count')
        .eq('telegram_id', myTelegramId)
        .maybeSingle();
      if (meError) throw meError;
      me = meRow ? { ...meRow, total_spent: meRow.ref_count } : null;
    }

    // --- Призы для топ-3 по рефералам ---
    const { data: rawPrizes, error: prizesError } = await supabase
      .from('gifts_for_cases')
      .select('spender_place_ref, nft_name, slug')
      .in('spender_place_ref', [1, 2, 3])
      .order('spender_place_ref', { ascending: true });
    if (prizesError) throw prizesError;

    const prizes = (rawPrizes || []).map(p => ({
      place: p.spender_place_ref,
      nft_name: p.nft_name ?? null,
      slug: p.slug ?? null,
    }));

    // --- Дата окончания сезона ---
    const { data: settings, error: settingsError } = await supabase
      .from('leaderboard_settings')
      .select('end_at')
      .order('end_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (settingsError) throw settingsError;

    // --- Форматирование ответа под фронт
    const listFormatted = (list || []).map(row => ({ ...row, total_spent: row.ref_count }));
    const top3Formatted = (top3 || []).map(row => ({ ...row, total_spent: row.ref_count }));

    return res.status(200).json({
      top3: top3Formatted,
      list: listFormatted,
      me,                             // null, если нет JWT
      total: count ?? listFormatted.length ?? 0,
      prizes,
      end_at: settings?.end_at ?? null,
    });
  } catch (error) {
    console.error('❌ /users/leaderboard-referrals error:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Server error' });
  }
};
