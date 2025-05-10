import { supabase } from '../../services/supabaseClient.js';

export const getUserWins = async (req, res) => {
  const { telegram_id } = req.params;

  if (!telegram_id) {
    return res.status(400).json({ error: 'telegram_id is required' });
  }

  const { data: wins, error } = await supabase
    .from('wheel_results')
    .select(`
      completed_at,
      wheel_id,
      wheels (
        nft_name,
        nft_number
      )
    `)
    .eq('telegram_id', telegram_id)
    .order('completed_at', { ascending: false });

  if (error) {
    console.error('❌ Failed to fetch wins:', error);
    return res.status(500).json({ error: 'Failed to fetch wins' });
  }

  const formatted = wins.map(win => ({
    completed_at: win.completed_at,
    nft_name: win.wheels.nft_name,
    nft_number: win.wheels.nft_number,
  }));

  res.json({ wins: formatted });
};
