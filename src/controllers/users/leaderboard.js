import { supabase } from '../../services/supabaseClient.js';

/**
 * GET /users/leaderboard?telegram_id=...&limit=10&offset=0
 * Возвращает:
 *  - top3: топ-3 по тратам (v_top_spenders)
 *  - list: список (пагинация)
 *  - me: место текущего пользователя
 *  - total: общее количество участников
 *  - prizes: призы для мест 1..3 из gifts_for_cases
 *           (колонка может называться spender_place ИЛИ top_spenders — поддержаны оба варианта)
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
    const { data: list, error: listError } = await supabase
      .from('v_top_spenders')
      .select('*')
      .order('rank', { ascending: true })
      .range(Number(offset), Number(offset) + Number(limit) - 1);
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

    // --- Призы для топ-3 из gifts_for_cases ---
    // Поддерживаем два варианта названия колонки: spender_place ИЛИ top_spenders
    // Забираем поля, которые пригодятся фронту: место + идентификаторы анимации (nft_name/slug)
    const { data: rawPrizes, error: prizesError } = await supabase
      .from('gifts_for_cases')
      .select('spender_place, nft_name, slug')
      .in('spender_place', [1, 2, 3])
      .order('spender_place', { ascending: true })
    if (prizesError) throw prizesError;

    // Нормализуем: приводим к одному полю place и убираем дубли
    const seen = new Set();
    const prizes = (rawPrizes || [])
      .map((p) => ({
        place: p.spender_place ?? p.top_spenders ?? null,
        nft_name: p.nft_name ?? null,
        slug: p.slug ?? null,
      }))
      .filter((p) => p.place === 1 || p.place === 2 || p.place === 3)
      .sort((a, b) => a.place - b.place)
      .filter((p) => {
        if (seen.has(p.place)) return false;
        seen.add(p.place);
        return true;
      });

    // Ответ
    res.status(200).json({
      top3,
      list,
      me,
      total: count ?? 0,
      prizes, // [{ place:1, nft_name:'...', slug:'...' }, ...]
    });
  } catch (error) {
    console.error('❌ /users/leaderboard error:', error?.message || error);
    res.status(500).json({ error: error?.message || 'Server error' });
  }
};

export default getLeaderboard;
