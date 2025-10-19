import { supabase } from '../../services/supabaseClient.js';

const getTicketPurchases = async (req, res) => {
  try {
    // 🛡️ Достаём telegram_id из токена
    const telegram_id = req.user?.telegram_id;

    if (!telegram_id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // 📜 Получаем историю покупок из таблицы sells
    const { data, error } = await supabase
      .from('sells')
      .select('amount, wallet, created_at')
      .eq('telegram_id', telegram_id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching sells:', error);
      return res.status(500).json({ error: 'Failed to fetch purchases' });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('❌ Unexpected error in getTicketPurchases:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
};

export default getTicketPurchases;
