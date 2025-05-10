import { supabase } from '../../services/supabaseClient.js';

const updateWallet = async (req, res) => {
  const { telegram_id, wallet } = req.body;

  if (!telegram_id || !wallet) {
    return res.status(400).json({ error: 'telegram_id and wallet are required' });
  }

  const { data, error } = await supabase
    .from('users')
    .update({ wallet })
    .eq('telegram_id', telegram_id)
    .select();

  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.length === 0) return res.status(404).json({ error: 'User not found' });

  res.status(200).json({
    message: 'Wallet updated successfully',
    user: data[0]
  });
};

export default updateWallet;
