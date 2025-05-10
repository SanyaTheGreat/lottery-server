import { supabase } from '../../services/supabaseClient.js';

export const getActiveWheels = async (req, res) => {
  const { data: wheels, error } = await supabase
    .from('wheels')
    .select('*')
    .eq('status', 'active');

  if (error) {
    console.error('❌ Error fetching active wheels:', error);
    return res.status(500).json({ error: 'Failed to fetch active wheels' });
  }

  if (!wheels || wheels.length === 0) {
    return res.status(200).json({ wheels: [] });
  }

  const wheelIds = wheels.map(w => w.id);

  // Получаем всех участников без группировки
  const { data: participants, error: participantsError } = await supabase
    .from('wheel_participants')
    .select('wheel_id, user_id')
    .in('wheel_id', wheelIds);

  if (participantsError) {
    console.error('❌ Error fetching participants:', participantsError);
    return res.status(500).json({ error: 'Failed to fetch participants' });
  }

  // Считаем количество участников по каждому wheel_id
  const counts = participants.reduce((acc, p) => {
    acc[p.wheel_id] = (acc[p.wheel_id] || 0) + 1;
    return acc;
  }, {});

  const enrichedWheels = wheels.map(w => ({
    ...w,
    current_participants: counts[w.id] || 0,
    slots_remaining: w.size - (counts[w.id] || 0)
  }));

  res.status(200).json({ wheels: enrichedWheels });
};
