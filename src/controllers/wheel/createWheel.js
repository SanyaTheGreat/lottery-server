// backend/controllers/wheel/createWheel.js
import { supabase } from '../../services/supabaseClient.js';

export const createWheel = async (req, res) => {
  const gemKey = req.headers['x-gem-key'];

  if (!gemKey || gemKey !== process.env.GEM_KEY) {
    return res.status(403).json({ error: 'Forbidden: Invalid GEM key' });
  }

  
  const { nft_name, nft_number, size, price, msg_id, mode, channel, promokey, msg } = req.body;

  if (!nft_name || !nft_number || !size || price === undefined || !msg_id) {
    return res.status(400).json({ error: 'нужно указать nft_name, nft_number, size, price, msg_id' });
  }

  if (mode === 'subscription' && !channel) {
    return res.status(400).json({ error: 'для режима subscription нужно указать channel' });
  }

  if (mode === 'promo' && !promokey) {
    return res.status(400).json({ error: 'для режима promo нужно указать promokey' });
  }

  // нормализуем флаг оповещения: "yes"/"true"/1 → "yes", иначе null
  const shouldNotify =
    typeof msg === 'string'
      ? ['yes', 'true', '1'].includes(msg.toLowerCase())
      : (msg === true || msg === 1);

  const insertData = {
    nft_name,
    nft_number,
    size,
    price,
    msg_id,
    status: 'active',
    mode: mode || null,
    channel: channel || null,
    promokey: promokey || null,
    msg: shouldNotify ? 'yes' : null,
  };

  const { data, error } = await supabase
    .from('wheels')
    .insert([insertData])
    .select();

  if (error) {
    console.error('❌ Error creating wheel:', error);
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json({
    message: 'Wheel created',
    wheel: data[0],
  });
};
