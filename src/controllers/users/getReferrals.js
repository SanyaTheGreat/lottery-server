import { supabase } from '../../services/supabaseClient.js';

const getReferrals = async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 1️⃣ Находим пользователя и берём все нужные поля
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, referral_earnings, referral_can')
      .eq('telegram_id', telegram_id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 2️⃣ Считаем количество рефералов
    const { count, error: countError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('referred_by', user.id);

    if (countError) {
      console.error('❌ Error fetching referrals:', countError);
      return res.status(500).json({ error: 'Failed to fetch referrals' });
    }

    const referral_count = count ?? 0;
    const referral_earnings = parseFloat(user.referral_earnings || 0);
    const referral_can = parseFloat(user.referral_can || 0);

    return res.status(200).json({ referral_count, referral_earnings, referral_can });
  } catch (err) {
    console.error('❌ Unexpected error in getReferrals:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
};

export default getReferrals;
