import { supabase } from '../../services/supabaseClient.js';

export const deleteWheel = async (req, res) => {
  const { wheel_id } = req.params;

  if (!wheel_id) {
    return res.status(400).json({ error: 'wheel_id is required' });
  }

  // Проверяем существует ли колесо
  const { data: wheel, error: wheelError } = await supabase
    .from('wheels')
    .select('id, status')
    .eq('id', wheel_id)
    .single();

  if (wheelError || !wheel) {
    return res.status(404).json({ error: 'Wheel not found' });
  }

  // Разрешаем только active
  if (wheel.status !== 'active') {
    return res.status(403).json({ error: 'Only active wheels can be deleted or cancelled' });
  }

  // Проверяем есть ли участники
  const { data: participants, error: participantsError } = await supabase
    .from('wheel_participants')
    .select('id')
    .eq('wheel_id', wheel_id);

  if (participantsError) {
    return res.status(500).json({ error: 'Failed to check participants' });
  }

  if (participants.length > 0) {
    // Меняем статус на cancelled
    const { error: updateError } = await supabase
      .from('wheels')
      .update({ status: 'cancelled' })
      .eq('id', wheel_id);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to cancel wheel' });
    }

    return res.status(200).json({
      message: 'Wheel had participants — status set to cancelled',
    });
  }

  // Если участников нет — можно удалить
  const { error: deleteError } = await supabase
    .from('wheels')
    .delete()
    .eq('id', wheel_id);

  if (deleteError) {
    return res.status(500).json({ error: 'Failed to delete wheel' });
  }

  res.status(200).json({ message: 'Wheel deleted successfully' });
};
