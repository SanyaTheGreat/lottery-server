import { supabase } from '../../services/supabaseClient.js';

export const getAllResults = async (req, res) => {
  const { data, error } = await supabase
    .from('wheel_results')
    .select(`
      wheel_id,
      completed_at,
      wheels (
        nft_name,
        nft_number,
        msg_id
      ),
      username,
      telegram_id
    `)
    .order('completed_at', { ascending: false });

  if (error) {
    console.error('❌ Failed to fetch results:', error);
    return res.status(500).json({ error: 'Failed to fetch results' });
  }

  const results = data.map(r => ({
    wheel_id: r.wheel_id,
    completed_at: r.completed_at,
    nft_name: r.wheels?.nft_name,
    nft_number: r.wheels?.nft_number,
    msg_id: r.wheels?.msg_id,
    winner: r.username || r.telegram_id
  }));

  res.json({ results });
};
