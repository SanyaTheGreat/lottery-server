import { supabase } from '../../services/supabaseClient.js';

const getLeaderboard = async (req, res) => {
  try {
    const { telegram_id, limit = 50, offset = 0 } = req.query;

    // 🔹 Топ-3 пользователей
    const { data: top3, error: top3Error } = await supabase
      .from('v_top_spenders')
      .select('*')
      .order('rank', { ascending: true })
      .limit(3);

    if (top3Error) throw top3Error;

    // 🔹 Основной список с пагинацией
    const { data: list, error: listError } = await supabase
      .from('v_top_spenders')
      .select('*')
      .order('rank', { ascending: true })
      .range(offset, offset + limit - 1);

    if (listError) throw listError;

    // 🔹 Текущее место пользователя (если передан telegram_id)
    let me = null;
    if (telegram_id) {
      const { data: userRank, error: meError } = await supabase
        .from('v_top_spenders')
        .select('rank, username, total_spent')
        .eq('telegram_id', telegram_id)
        .maybeSingle();

      if (meError) throw meError;
      me = userRank;
    }

    // 🔹 Общее количество участников (для пагинации)
    const { count, error: countError } = await supabase
      .from('v_top_spenders')
      .select('rank', { count: 'exact', head: true });

    if (countError) throw countError;

    // ✅ Финальный ответ
    res.status(200).json({
      top3,
      list,
      me,
      total: count,
    });
  } catch (error) {
    console.error('❌ Ошибка получения лидерборда:', error.message);
    res.status(500).json({ error: error.message });
  }
};

export default getLeaderboard;
