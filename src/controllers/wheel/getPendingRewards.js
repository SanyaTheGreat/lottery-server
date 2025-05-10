import { supabase } from '../../services/supabaseClient.js';

export const getPendingRewards = async (req, res) => {
  const { data, error } = await supabase
    .from('pending_rewards')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('❌ Failed to fetch pending rewards:', error);
    return res.status(500).json({ error: 'Failed to fetch pending rewards' });
  }

  res.status(200).json({ pending_rewards: data });
};
