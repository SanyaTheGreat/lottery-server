import { supabase } from '../../services/supabaseClient.js';

export const getParticipations = async (req, res) => {
  const { telegram_id } = req.params;

  if (!telegram_id) {
    return res.status(400).json({ error: 'telegram_id is required' });
  }

  const { data, error } = await supabase
    .from('wheel_participants')
    .select(`
      wheel_id,
      joined_at,
      wheels (
        nft_name,
        nft_number,
        price
      )
    `)
    .eq('telegram_id', telegram_id)
    .order('joined_at', { ascending: false });

  if (error) {
    console.error('❌ Failed to fetch participations:', error);
    return res.status(500).json({ error: 'Failed to fetch participations' });
  }

  const participations = data.map(p => ({
    joined_at: p.joined_at,
    ...p.wheels
  }));

  res.status(200).json({ participations });
};


