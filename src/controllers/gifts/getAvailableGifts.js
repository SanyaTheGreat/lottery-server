import { supabase } from '../../services/supabaseClient.js';

export const getAvailableGifts = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('available_gifts')
      .select('nft_name, nft_number, msg_id, used');

    if (error) {
      console.error('❌ Error fetching available gifts:', error);
      return res.status(500).json({ error: 'Failed to fetch gifts' });
    }

    res.status(200).json({ gifts: data });
  } catch (err) {
    console.error('❌ Server error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
