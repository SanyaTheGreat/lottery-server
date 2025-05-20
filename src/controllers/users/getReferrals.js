import { supabase } from '../../services/supabaseClient.js';

const getReferrals = async (req, res) => {
  const { telegram_id } = req.params;

  if (!telegram_id) {
    return res.status(400).json({ error: 'Telegram ID is required' });
  }

  // Получаем ID пользователя по telegram_id
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('telegram_id', telegram_id)
    .single();

  if (userError || !user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // ✅ Получаем всех пользователей, у кого этот id записан как referred_by
  const { data: referrals, error } = await supabase
    .from('users')
    .select('referral_earnings') // ✅ Только нужное поле
    .eq('referred_by', user.id);

  if (error) {
    console.error("❌ Error fetching referrals:", error);
    return res.status(500).json({ error: 'Failed to fetch referrals' });
  }

  // ✅ Подсчитываем количество и сумму заработка
  const referral_count = referrals.length;
  const referral_earnings = referrals.reduce(
    (sum, r) => sum + (parseFloat(r.referral_earnings || 0)),
    0
  );

  // ✅ Возвращаем в формате, ожидаемом фронтендом
  res.status(200).json({
    referral_count,
    referral_earnings
  });
};

export default getReferrals;
