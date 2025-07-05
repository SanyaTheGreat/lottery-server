import { supabase } from '../../services/supabaseClient.js';
import { handleTransaction } from './processPurchase.js';

const buyTickets = async (req, res) => {
  const { telegram_id, quantity } = req.body;

  if (!telegram_id || typeof quantity !== 'number' || quantity <= 0) {
    return res.status(400).json({ error: 'telegram_id and valid ticket count (quantity) are required' });
  }

  // Получаем пользователя по telegram_id
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('wallet')
    .eq('telegram_id', telegram_id)
    .single();

  if (userError || !userData) {
    return res.status(404).json({ error: 'User not found' });
  }

  const userWallet = userData.wallet;

  if (!userWallet) {
    return res.status(400).json({ error: 'User does not have wallet' });
  }

  // Вызываем общую функцию для начисления билетов и записи в sells
  await handleTransaction(userWallet, quantity);

  res.json({ message: 'Tickets purchased' });
};

export default buyTickets;
