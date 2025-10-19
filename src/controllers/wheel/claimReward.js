import { supabase } from '../../services/supabaseClient.js';
// импорт sendTelegramGift оставь как у тебя
// import { sendTelegramGift } from '../...';

export const claimReward = async (req, res) => {
  // ✅ берём пользователя из токена
  const telegram_id = req.user?.telegram_id;
  if (!telegram_id) return res.status(401).json({ error: 'Unauthorized' });

  // 1) Ищем последний невыплаченный приз этого пользователя
  const { data: reward, error: fetchError } = await supabase
    .from('pending_rewards')
    .select('*')
    .eq('telegram_id', telegram_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (fetchError || !reward) {
    return res.status(404).json({ error: 'No pending reward found' });
  }

  try {
    // 2) Пытаемся «забронировать» награду и пометить как confirmed
    // (idempotency: обновляем ТОЛЬКО если она всё ещё pending)
    const { data: updatedRows, error: updateError } = await supabase
      .from('pending_rewards')
      .update({ status: 'confirmed', sent_at: new Date().toISOString() })
      .eq('id', reward.id)
      .eq('status', 'pending')
      .select(); // вернёт пусто, если статус уже поменяли с другого запроса

    if (updateError) {
      console.error('❌ Error updating reward status:', updateError);
      return res.status(500).json({ error: 'Failed to update reward status' });
    }

    if (!updatedRows || updatedRows.length === 0) {
      // кто-то успел подтвердить параллельно
      return res.status(409).json({ error: 'Reward already claimed' });
    }

    // 3) Отправляем подарок после успешной фиксации
    await sendTelegramGift(telegram_id, reward.nft_name);

    return res.json({ message: 'Reward sent successfully' });
  } catch (err) {
    console.error('❌ Failed to send gift:', err?.message || err);
    return res.status(500).json({ error: 'Failed to send gift' });
  }
};
