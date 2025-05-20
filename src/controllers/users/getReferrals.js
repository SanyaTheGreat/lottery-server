import { supabase } from '../../services/supabaseClient.js';

const getReferrals = async (req, res) => {
  const { telegram_id } = req.params;

  if (!telegram_id) {
    return res.status(400).json({ error: 'Telegram ID is required' });
  }

  // ✅ Получаем ID и referral_earnings пользователя по telegram_id
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, referral_earnings') // добавили referral_earnings
    .eq('telegram_id', telegram_id)
    .single();

  if (userError || !user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // ✅ Получаем всех пользователей, у кого этот id записан как referred_by
  const { data: referrals, error } = await supabase
    .from('users')
    .select('id') // нам не нужны лишние поля
    .eq('referred_by', user.id);

  if (error) {
    console.error("❌ Error fetching referrals:", error);
    return res.status(500).json({ error: 'Failed to fetch referrals' });
  }

  // ✅ Подсчитываем количество
  const referral_count = referrals.length;

  // ✅ referral_earnings берём напрямую у пользователя
  const referral_earnings = parseFloat(user.referral_earnings || 0);

  // ✅ Возвращаем объект, как ожидает frontend
  res.status(200).json({
    referral_count,
    referral_earnings
  });
};

export default getReferrals;
