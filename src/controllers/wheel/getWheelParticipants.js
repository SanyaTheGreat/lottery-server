import { supabase } from '../../services/supabaseClient.js';

export const getWheelParticipants = async (req, res) => {
  const { wheel_id } = req.params;

  if (!wheel_id) {
    return res.status(400).json({ error: 'wheel_id is required' });
  }

  const { data, error } = await supabase
    .from('wheel_participants')
    .select('user_id, username, joined_at')
    .eq('wheel_id', wheel_id)
    .order('joined_at', { ascending: true });

  if (error) {
    console.error('❌ Error fetching participants:', error);
    return res.status(500).json({ error: 'Failed to fetch participants' });
  }

  res.status(200).json({ participants: data });
};
