import { supabase } from '../../services/supabaseClient.js';

const buyTickets = async (req, res) => {
  const { telegram_id, quantity, wallet } = req.body;

  if (!telegram_id || typeof quantity !== 'number' || quantity <= 0) {
    return res.status(400).json({ error: 'telegram_id and valid ticket count (quantity) are required' });
  }

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegram_id)
    .single();

  if (userError || !userData) {
    return res.status(404).json({ error: 'User not found' });
  }

  const newTicketCount = userData.tickets + quantity;
  let updates = { tickets: newTicketCount };

  if (userData.referred_by) {
    const bonus = quantity * 0.1;

    const { error: refError } = await supabase
      .rpc('increment_referral_earnings', {
        ref_id: userData.referred_by,
        bonus_amount: bonus
      });

    if (refError) {
      console.error("❌ Error updating referral earnings:", refError);
    }
  }

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('telegram_id', telegram_id)
    .select();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // ➕ Запись в таблицу sells
  await supabase.from('sells').insert([{
    telegram_id,
    wallet: wallet || userData.wallet || null,
    amount: quantity
  }]);


  res.json({ message: 'Tickets purchased', user: data?.[0] || null });
};

export default buyTickets;
