import { supabase } from '../../services/supabaseClient.js';

export const createWheel = async (req, res) => {
  const { nft_name, nft_number, size, price, msg_id } = req.body;

  if (!nft_name || !nft_number || !size || !price || !msg_id) {
    return res.status(400).json({ error: 'имя номер размер цена мсдж' });
  }

  const { data, error } = await supabase
    .from('wheels')
    .insert([{ nft_name, nft_number, size, price, msg_id, status: 'active' }])
    .select();

  if (error) {
    console.error('❌ Error creating wheel:', error);
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json({ message: 'Wheel created', wheel: data[0] });
};
