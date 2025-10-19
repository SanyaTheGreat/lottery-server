import { supabase } from '../../services/supabaseClient.js';

// список админов через ENV: ADMIN_TG_IDS="123,456"
const isAdmin = (tgid) => (process.env.ADMIN_TG_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean).includes(String(tgid));

const toNano = (v) => BigInt(Math.round(Number(v) * 1e9));
const fromNano = (n) => (Number(n) / 1e9).toFixed(9);

const buyTickets = async (req, res) => {
  const caller = req.user?.telegram_id;
  if (!caller || !isAdmin(caller)) return res.status(403).json({ error: 'Forbidden' });

  const { target_telegram_id, quantity } = req.body || {};
  const qty = Number(quantity);
  if (!target_telegram_id || !Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ error: 'target_telegram_id and positive quantity are required' });
  }

  const { data: user, error: userErr } = await supabase
    .from('users').select('id, tickets, wallet').eq('telegram_id', target_telegram_id).single();
  if (userErr || !user) return res.status(404).json({ error: 'User not found' });

  const newNano = toNano(user.tickets || 0) + toNano(qty);
  const newStr = fromNano(newNano);

  const { error: updErr } = await supabase.from('users')
    .update({ tickets: newStr }).eq('telegram_id', target_telegram_id);
  if (updErr) return res.status(500).json({ error: 'Failed to update tickets' });

  await supabase.from('sells').insert([{
    telegram_id: target_telegram_id,
    user_id: user.id,
    wallet: user.wallet || null,
    amount: fromNano(toNano(qty)),
    status: 'manual_admin',
    tx_hash: null,
    payload: null,
  }]);

  return res.json({ message: 'Tickets credited by admin', new_balance: newStr });
};

export default buyTickets;
