import { supabase } from '../../services/supabaseClient.js';

const createSell = async (req, res) => {
  const { telegram_id, wallet, amount } = req.body;

  if (!telegram_id || !wallet || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { error } = await supabase.from('sells').insert([
    {
      telegram_id,
      wallet,
      amount,
    }
  ]);

  if (error) {
    return res.status(500).json({ error: 'Failed to save sell' });
  }

  res.status(201).json({ message: 'Sell recorded' });
};

export default createSell;
