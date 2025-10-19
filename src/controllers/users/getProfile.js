import { supabase } from '../../services/supabaseClient.js';

export const getProfile = async (req, res) => {
  try {
    // ✅ Получаем telegram_id из JWT (устанавливается в middleware)
    const telegram_id = req.user?.telegram_id;

    if (!telegram_id) {
      return res.status(401).json({ error: 'Unauthorized: no telegram_id in token' });
    }

    // Получаем профиль пользователя
    const { data, error } = await supabase
      .from('users')
      .select('telegram_id, username, wallet, tickets, payload, referral_earnings, avatar_url')
      .eq('telegram_id', telegram_id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Проверка, доступен ли вывод
    const withdraw_available = parseFloat(data.referral_earnings || 0) >= 2;

    res.status(200).json({
      ...data,
      withdraw_available,
    });
  } catch (err) {
    console.error('❌ Error in getProfile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
