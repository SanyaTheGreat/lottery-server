import { supabase } from '../../services/supabaseClient.js';

const getProfile = async (req, res) => {
  const { telegram_id } = req.params;

  if (!telegram_id) {
    return res.status(400).json({ error: 'Telegram ID is required' });
  }

  const { data, error } = await supabase
    .from('users')
    .select('username, wallet, tickets, referral_earnings')
    .eq('telegram_id', telegram_id)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Проверка, доступен ли вывод
  const withdraw_available = parseFloat(data.referral_earnings || 0) >= 2;

  res.json({
    ...data,
    withdraw_available
  });
};

export default getProfile;
