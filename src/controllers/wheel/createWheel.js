import { supabase } from '../../services/supabaseClient.js';

export const createWheel = async (req, res) => {
  const gemKey = req.headers['x-gem-key'];

  if (!gemKey || gemKey !== process.env.GEM_KEY) {
    return res.status(403).json({ error: 'Forbidden: Invalid GEM key' });
  }

  const { nft_name, nft_number, size, price, msg_id, mode, channel, promokey } = req.body;

  if (!nft_name || !nft_number || !size || price === undefined || !msg_id) {
    return res.status(400).json({ error: 'нужно указать nft_name, nft_number, size, price, msg_id' });
  }

  // если mode = subscription → channel обязателен
  if (mode === 'subscription' && !channel) {
    return res.status(400).json({ error: 'для режима subscription нужно указать channel' });
  }

  // если mode = promo → promokey обязателен
  if (mode === 'promo' && !promokey) {
    return res.status(400).json({ error: 'для режима promo нужно указать promokey' });
  }

  const insertData = {
    nft_name,
    nft_number,
    size,
    price,
    msg_id,
    status: 'active',
    mode: mode || null,
    channel: channel || null,
    promokey: promokey || null
  };

  const { data, error } = await supabase
    .from('wheels')
    .insert([insertData])
    .select();

  if (error) {
    console.error('❌ Error creating wheel:', error);
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json({ message: 'Wheel created', wheel: data[0] });
};
