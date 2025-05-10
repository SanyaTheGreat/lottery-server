import { supabase } from '../../services/supabaseClient.js';

export const drawWinner = async (req, res) => {
  const { wheel_id } = req.params;

  if (!wheel_id) {
    return res.status(400).json({ error: 'wheel_id is required' });
  }

  // Получаем информацию о колесе
  const { data: wheel, error: wheelError } = await supabase
    .from('wheels')
    .select('id, size, status, nft_name, nft_number, msg_id')
    .eq('id', wheel_id)
    .single();

  if (wheelError || !wheel) {
    return res.status(404).json({ error: 'Wheel not found' });
  }

  if (wheel.status !== 'active') {
    return res.status(400).json({ error: 'Wheel is not active or already completed' });
  }

  // Получаем участников
  const { data: participants, error: participantsError } = await supabase
    .from('wheel_participants')
    .select('user_id, telegram_id, username')
    .eq('wheel_id', wheel_id);

  if (participantsError || !participants || participants.length === 0) {
    return res.status(500).json({ error: 'Failed to fetch participants' });
  }

  if (participants.length < wheel.size) {
    return res.status(400).json({ error: 'Wheel is not full yet' });
  }

  // Выбираем случайного участника
  const winner = participants[Math.floor(Math.random() * participants.length)];

  // Сохраняем результат розыгрыша
const { error: resultError } = await supabase
.from('wheel_results')
.insert([{
  wheel_id,
  winner_id: winner.user_id,
  telegram_id: winner.telegram_id,
  username: winner.username,
  nft_number: wheel.nft_number,
  nft_name: wheel.nft_name,
  msg_id: wheel.msg_id,
  completed_at: new Date().toISOString()
}]);

if (resultError) {
console.error('❌ Error saving result:', resultError);
return res.status(500).json({ error: 'Failed to save draw result' });
}

const { error: logError } = await supabase
  .from('pending_rewards')
  .insert([{
    wheel_id,
    winner_id: winner.user_id,
    telegram_id: winner.telegram_id,
    username: winner.username,
    nft_name: wheel.nft_name,
    nft_number: wheel.nft_number,
    msg_id: wheel.msg_id,
    status: 'pending'
  }]);

if (logError) {
  console.error('❌ Error logging pending reward:', logError);
}

  // Получаем Telegram ID и username победителя
  const { data: winnerInfo, error: userError } = await supabase
    .from('users')
    .select('telegram_id, username')
    .eq('id', winner.user_id)
    .single();

  if (userError || !winnerInfo) {
    return res.status(500).json({ error: 'Failed to fetch winner info' });
  }

  // Обновляем колесо
  const { error: updateError } = await supabase
    .from('wheels')
    .update({
      winner_id: winner.user_id,
      completed_at: new Date().toISOString(),
      status: 'completed'
    })
    .eq('id', wheel_id);

  if (updateError) {
    return res.status(500).json({ error: 'Failed to update wheel with winner' });
  }

  res.status(200).json({
    message: 'Winner selected',
    wheel_id,
    winner_id: winner.user_id,
    telegram_id: winnerInfo.telegram_id,
    username: winnerInfo.username
  });
};
