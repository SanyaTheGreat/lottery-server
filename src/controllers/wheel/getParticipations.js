import { supabase } from '../../services/supabaseClient.js';

export const getParticipations = async (req, res) => {
  // ✅ теперь берём пользователя из токена, а не из params
  const telegram_id = req.user?.telegram_id;
  if (!telegram_id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // 🔐 запрашиваем все участия по текущему пользователю
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

    const participations = (data || []).map((p) => ({
      joined_at: p.joined_at,
      ...p.wheels,
    }));

    return res.status(200).json({ participations });
  } catch (err) {
    console.error('❌ Unexpected error:', err);
    return res.status(500).json({ error: 'Unexpected server error' });
  }
};
