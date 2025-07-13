import { supabase } from '../../services/supabaseClient.js';

export const getWheelById = async (req, res) => {
  const { wheel_id } = req.params;

  try {
    const { data, error } = await supabase
      .from('wheels')
      .select('id, size, nft_name, nft_number, status')
      .eq('id', wheel_id)
      .single();

    if (error) {
      console.error('Ошибка получения колеса:', error);
      return res.status(500).json({ error: 'Ошибка получения колеса' });
    }

    if (!data) {
      return res.status(404).json({ error: 'Колесо не найдено' });
    }

    res.status(200).json(data);
  } catch (err) {
    console.error('Unexpected error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};
