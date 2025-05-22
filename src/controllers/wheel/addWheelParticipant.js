import { supabase } from '../../services/supabaseClient.js';

export const joinWheel = async (req, res) => {
  const { wheel_id, user_id, telegram_id, username } = req.body;

  if (!wheel_id || !user_id || !username || !telegram_id ) {
    return res.status(400).json({ error: 'wheel_id, user_id, and username are required' });
  }

  // Получаем данные о колесе (в том числе цену участия)
  const { data: wheel, error: wheelError } = await supabase
    .from('wheels')
    .select('id, size, price')
    .eq('id', wheel_id)
    .single();

  if (wheelError || !wheel) {
    return res.status(404).json({ error: 'Wheel not found' });
  }

  // Проверяем, участвует ли уже пользователь
  const { data: existing, error: existError } = await supabase
    .from('wheel_participants')
    .select('id')
    .eq('wheel_id', wheel_id)
    .eq('user_id', user_id)
    .maybeSingle();

  if (existError) {
    return res.status(500).json({ error: 'Error checking participation' });
  }

  if (existing) {
    return res.status(409).json({ error: 'User already joined this wheel' });
  }

  // Получаем текущее количество участников
  const { count: currentCount, error: countError2 } = await supabase
    .from('wheel_participants')
    .select('*', { count: 'exact', head: true })
    .eq('wheel_id', wheel_id);

  if (countError2) {
    return res.status(500).json({ error: 'Failed to count participants' });
  }

  if (currentCount >= wheel.size) {
    return res.status(403).json({ error: 'Wheel is full' });
  }

  // Получаем пользователя и проверяем, достаточно ли у него билетов
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('tickets')
    .eq('id', user_id)
    .single();

  if (userError || !user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (user.tickets < wheel.price) {
    return res.status(400).json({ error: 'Not enough tickets to join this wheel' });
  }

  // Списываем билеты у пользователя
  const { error: updateError } = await supabase
    .from('users')
    .update({ tickets: user.tickets - wheel.price })
    .eq('id', user_id);

  if (updateError) {
    return res.status(500).json({ error: 'Failed to update tickets' });
  }

  // Добавляем участника в розыгрыш
  const { data, error } = await supabase
    .from('wheel_participants')
    .insert([{ wheel_id, user_id, telegram_id, username }])
    .select();

  if (error) {
    console.error('🔥 Insert participant error:', error);
    return res.status(500).json({ error: error.message });
  }

  // 🔄 Проверка: заполнено ли колесо
  const { count, error: countError } = await supabase
  .from('wheel_participants')
  .select('*', { count: 'exact', head: true })
  .eq('wheel_id', wheel_id);

  const { data: wheelInfo, error: wheelInfoError } = await supabase
  .from('wheels')
  .select('size, run_at')
  .eq('id', wheel_id)
  .single();

  if (!countError && !wheelInfoError && count >= wheelInfo.size && !wheelInfo.run_at) {
  const runAt = new Date(Date.now() + 60 * 1000).toISOString();
  await supabase
    .from('wheels')
    .update({ run_at: runAt })
    .eq('id', wheel_id);
  }

  res.status(201).json({
    message: 'User joined the wheel successfully',
    participant: data?.[0] || null,
  });
};
  