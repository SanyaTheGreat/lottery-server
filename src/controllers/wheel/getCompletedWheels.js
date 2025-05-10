import { supabase } from '../../services/supabaseClient.js';

export const getCompletedWheels = async (req, res) => {
  const { data, error } = await supabase
    .from('wheels')
    .select(`
      id,
      nft_name,
      nft_number,
      completed_at,
      winner_id,
      users: winner_id (
        username,
        telegram_id
      )
    `)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false });

  if (error) {
    console.error('❌ Failed to fetch completed wheels:', error);
    return res.status(500).json({ error: 'Failed to fetch completed wheels' });
  }

  const formatted = data.map(wheel => ({
    id: wheel.id,
    nft_name: wheel.nft_name,
    nft_number: wheel.nft_number,
    completed_at: wheel.completed_at,
    winner: {
      username: wheel.users?.username || null,
      telegram_id: wheel.users?.telegram_id || null
    }
  }));

  res.status(200).json({ completed_wheels: formatted });
};
