import { supabase } from '../../services/supabaseClient.js';

const updateWallet = async (req, res) => {
  try {
    // ✅ Берём telegram_id только из токена (а не из тела)
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) {
      return res.status(401).json({ error: 'Unauthorized: no telegram_id in token' });
    }

    // 🧩 Новое значение кошелька должно прийти в теле запроса
    const { wallet } = req.body;
    if (!wallet || typeof wallet !== 'string' || wallet.length < 30) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // 🔎 Обновляем только свой кошелёк
    const { data, error } = await supabase
      .from('users')
      .update({ wallet })
      .eq('telegram_id', telegram_id)
      .select('id, telegram_id, username, wallet, tickets, referral_earnings')
      .single();

    if (error) {
      console.error('❌ Error updating wallet:', error.message);
      return res.status(500).json({ error: 'Failed to update wallet' });
    }

    if (!data) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({
      message: 'Wallet updated successfully',
      user: data,
    });
  } catch (err) {
    console.error('❌ updateWallet unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export default updateWallet;
