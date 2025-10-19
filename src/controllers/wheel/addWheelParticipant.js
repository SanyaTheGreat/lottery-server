import { supabase } from '../../services/supabaseClient.js';

const toNano = (val) => BigInt(Math.round(Number(val) * 1e9));
const fromNano = (nano) => (Number(nano) / 1e9).toFixed(9);

// проверка подписки через основного бота
async function checkSubscription(botToken, channel, telegram_id) {
  const url = `https://api.telegram.org/bot${botToken}/getChatMember?chat_id=${channel}&user_id=${telegram_id}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) return false;
    const status = data.result.status;
    return ['creator', 'administrator', 'member'].includes(status);
  } catch {
    return false;
  }
}

export const joinWheel = async (req, res) => {
  // ⚠️ теперь ждём только wheel_id (+ promokey), пользователя берём из JWT
  const { wheel_id, promokey } = req.body || {};
  const telegram_id = req.user?.telegram_id;           // из JWT
  const usernameFromToken = req.user?.username || null;

  if (!wheel_id) return res.status(400).json({ error: 'wheel_id is required' });
  if (!telegram_id) return res.status(401).json({ error: 'Unauthorized' });

  // 1) Получаем данные о колесе
  const { data: wheel, error: wheelError } = await supabase
    .from('wheels')
    .select('id, size, price, mode, channel, promokey')
    .eq('id', wheel_id)
    .single();
  if (wheelError || !wheel) return res.status(404).json({ error: 'Wheel not found' });

  // 2) Проверки доступа
  if (wheel.mode === 'subscription') {
    const ok = await checkSubscription(process.env.BOT_TOKEN, wheel.channel, telegram_id);
    if (!ok) return res.status(403).json({ error: 'Нужно подписаться на канал для участия' });
  }
  if (wheel.mode === 'promo') {
    if (!promokey || promokey !== wheel.promokey) {
      return res.status(403).json({ error: 'Неверный промокод' });
    }
  }

  // 3) Находим пользователя по telegram_id
  const { data: dbUser, error: userErr } = await supabase
    .from('users')
    .select('id, username, tickets, referred_by')
    .eq('telegram_id', telegram_id)
    .single();
  if (userErr || !dbUser) return res.status(404).json({ error: 'User not found' });

  const user_id = dbUser.id;
  const username = dbUser.username || usernameFromToken || '';

  // 4) Уже участвует?
  const { data: existing, error: existError } = await supabase
    .from('wheel_participants')
    .select('id')
    .eq('wheel_id', wheel_id)
    .eq('user_id', user_id)
    .maybeSingle();
  if (existError) return res.status(500).json({ error: 'Error checking participation' });
  if (existing) return res.status(409).json({ error: 'User already joined this wheel' });

  // 5) Кол-во участников и заполненность
  const { count: currentCount, error: countError2 } = await supabase
    .from('wheel_participants')
    .select('*', { count: 'exact', head: true })
    .eq('wheel_id', wheel_id);
  if (countError2) return res.status(500).json({ error: 'Failed to count participants' });
  if (currentCount >= wheel.size) return res.status(403).json({ error: 'Wheel is full' });

  // 6) Списываем билеты (если цена > 0)
  if (Number(wheel.price) > 0) {
    if (Number(dbUser.tickets) < Number(wheel.price)) {
      return res.status(400).json({ error: 'Not enough tickets to join this wheel' });
    }

    const newTicketsNano = toNano(dbUser.tickets) - toNano(wheel.price);
    const newTicketsStr = fromNano(newTicketsNano);

    const { error: updateError } = await supabase
      .from('users')
      .update({ tickets: newTicketsStr })
      .eq('id', user_id);
    if (updateError) return res.status(500).json({ error: 'Failed to update tickets' });
  }

  // 7) Добавляем участника
  const { data, error } = await supabase
    .from('wheel_participants')
    .insert([{ wheel_id, user_id, telegram_id, username }])
    .select();
  if (error) {
    console.error('🔥 Insert participant error:', error);
    return res.status(500).json({ error: error.message });
  }

  // 8) Реферальный бонус (как было)
  if (dbUser.referred_by && Number(wheel.price) > 0) {
    const bonusNano = toNano(wheel.price) / 10n;
    const bonusStr = fromNano(bonusNano);
    try {
      await supabase.from('referral_earnings').insert([{
        referrer_id: dbUser.referred_by,
        referred_id: user_id,
        wheel_id,
        amount: bonusStr,
      }]);

      const { data: referrerData } = await supabase
        .from('users')
        .select('referral_earnings')
        .eq('id', dbUser.referred_by)
        .single();
      if (referrerData) {
        const newEarningsNano = toNano(referrerData.referral_earnings || 0) + bonusNano;
        const newEarningsStr = fromNano(newEarningsNano);
        await supabase
          .from('users')
          .update({ referral_earnings: newEarningsStr })
          .eq('id', dbUser.referred_by);
      }
    } catch (err) {
      console.error('Ошибка при начислении реферального бонуса:', err);
    }
  }

  // 9) Автозапуск, если колесо заполнилось
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
    await supabase.from('wheels').update({ run_at: runAt }).eq('id', wheel_id);
  }

  return res.status(201).json({
    message: 'User joined the wheel successfully',
    participant: data?.[0] || null,
  });
};
