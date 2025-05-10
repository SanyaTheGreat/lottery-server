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

  // Получаем всех пользователей, у кого этот id записан как referred_by
  const { data: referrals, error } = await supabase
    .from('users')
    .select('username, wallet, tickets, created_at')
    .eq('referred_by', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error("❌ Error fetching referrals:", error);
    return res.status(500).json({ error: 'Failed to fetch referrals' });
  }

  res.status(200).json(referrals);
};

export default getReferrals;
