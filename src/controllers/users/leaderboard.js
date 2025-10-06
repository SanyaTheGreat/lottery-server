import { supabase } from '../../services/supabaseClient.js';

/**
 * GET /users/leaderboard?telegram_id=...&limit=10&offset=0
 * Ответ:
 * {
 *   top3: [...],
 *   list: [...],
 *   me: { rank, username, avatar_url, total_spent } | null,
 *   total: number,
 *   prizes: [{ place: 1|2|3, nft_name: string|null, slug: string|null }],
 *   end_at: string | null  // ISO, например "2025-10-15T00:00:00.000Z"
 * }
 */
const getLeaderboard = async (req, res) => {
  try {
    const { telegram_id, limit = 10, offset = 0 } = req.query;

    // --- TOP-3 ---
    const { data: top3, error: top3Error } = await supabase
      .from('v_top_spenders')
      .select('*')
      .order('rank', { ascending: true })
      .limit(3);
    if (top3Error) throw top3Error;

    // --- Список (пагинация) ---
    const from = Number(offset);
    const to = from + Number(limit) - 1;
    const { data: list, error: listError } = await supabase
      .from('v_top_spenders')
      .select('*')
      .order('rank', { ascending: true })
      .range(from, to);
    if (listError) throw listError;

    // --- Место текущего пользователя ---
    let me = null;
    if (telegram_id) {
      const { data: userRank, error: meError } = await supabase
        .from('v_top_spenders')
        .select('rank, username, avatar_url, total_spent')
        .eq('telegram_id', telegram_id)
        .maybeSingle();
      if (meError) throw meError;
      me = userRank;
    }

    // --- Общее количество (для пагинации) ---
    const { count, error: countError } = await supabase
      .from('v_top_spenders')
      .select('rank', { count: 'exact', head: true });
    if (countError) throw countError;

    // --- Призы для топ-3 (берём из gifts_for_cases.spender_place) ---
    const { data: rawPrizes, error: prizesError } = await supabase
      .from('gifts_for_cases')
      .select('spender_place, nft_name, slug')
      .in('spender_place', [1, 2, 3])
      .order('spender_place', { ascending: true });
    if (prizesError) throw prizesError;

    const prizes = (rawPrizes || [])
      .map(p => ({
        place: p.spender_place,
        nft_name: p.nft_name ?? null,
        slug: p.slug ?? null, // можно использовать на фронте как имя файла анимации
      }))
      .sort((a, b) => a.place - b.place);

    // --- Дата окончания текущего сезона лидерборда ---
    const { data: settings, error: settingsError } = await supabase
      .from('leaderboard_settings')
      .select('end_at')
      .order('end_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (settingsError) throw settingsError;

    res.status(200).json({
      top3,
      list,
      me,
      total: count ?? 0,
      prizes,
      end_at: settings?.end_at ?? null,
    });
  } catch (error) {
    console.error('❌ /users/leaderboard error:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Server error' });
  }
};

export default getLeaderboard;
