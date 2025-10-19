import { supabase } from '../../services/supabaseClient.js';

const getLeaderboard = async (req, res) => {
  try {
    // 🔐 "me" определяется только по токену, а не по query
    const myTelegramId = req.user?.telegram_id || null;

    // пагинация с безопасными пределами
    const limitNum = Math.min(Math.max(parseInt(req.query.limit ?? '10', 10), 1), 100);
    const offsetNum = Math.max(parseInt(req.query.offset ?? '0', 10), 0);
    const from = offsetNum;
    const to = from + limitNum - 1;

    // --- TOP-3 ---
    const { data: top3, error: top3Error } = await supabase
      .from('v_top_spenders')
      .select('*')
      .order('rank', { ascending: true })
      .limit(3);
    if (top3Error) throw top3Error;

    // --- Список (пагинация) ---
    const { data: list, error: listError } = await supabase
      .from('v_top_spenders')
      .select('*')
      .order('rank', { ascending: true })
      .range(from, to);
    if (listError) throw listError;

    // --- Место текущего пользователя (если есть токен) ---
    let me = null;
    if (myTelegramId) {
      const { data: userRank, error: meError } = await supabase
        .from('v_top_spenders')
        .select('rank, username, avatar_url, total_spent')
        .eq('telegram_id', myTelegramId)
        .maybeSingle();
      if (meError) throw meError;
      me = userRank ?? null;
    }

    // --- Общее количество ---
    const { count, error: countError } = await supabase
      .from('v_top_spenders')
      .select('rank', { count: 'exact', head: true });
    if (countError) throw countError;

    // --- Призы для топ-3 ---
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
        slug: p.slug ?? null,
      }))
      .sort((a, b) => a.place - b.place);

    // --- Дата окончания сезона ---
    const { data: settings, error: settingsError } = await supabase
      .from('leaderboard_settings')
      .select('end_at')
      .order('end_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (settingsError) throw settingsError;

    return res.status(200).json({
      top3,
      list,
      me, // null, если нет токена
      total: count ?? 0,
      prizes,
      end_at: settings?.end_at ?? null,
    });
  } catch (error) {
    console.error('❌ /users/leaderboard error:', error?.message || error);
    return res.status(500).json({ error: error?.message || 'Server error' });
  }
};

export default getLeaderboard;
