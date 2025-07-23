import { supabase } from '../../services/supabaseClient.js';
import { beginCell } from '@ton/ton'; // добавьте импорт для beginCell

// Функция для преобразования base64 в base64url без паддинга
function toBase64Url(base64) {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const addUser = async (req, res) => {
  console.log('📥 [backend] Получен запрос на /users/register');

  const { telegram_id, username, wallet, referrer_id } = req.body;

  if (!telegram_id || !username) {
    return res.status(400).json({ error: 'Username and Telegram ID are required' });
  }

  const { data: existingUser, error: checkError } = await supabase
    .from('users')
    .select('id, referred_by')
    .eq('telegram_id', telegram_id)
    .limit(1);

  if (checkError) return res.status(500).json({ error: 'Database check failed' });
  if (existingUser && existingUser.length > 0)
    return res.status(409).json({ error: 'User already exists' });

  let referred_by = null;

  if (referrer_id && referrer_id !== telegram_id) {
    const { data: referrer } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', referrer_id)
      .limit(1);

    if (referrer && referrer[0]) referred_by = referrer[0].id;
  }

  // Генерация payload в формате base64url без паддинга
  const cell = beginCell()
    .storeUint(0, 32) // префикс (32 нуля)
    .storeStringTail(`${telegram_id}`)
    .endCell();

  const base64 = cell.toBoc().toString('base64');
  const payload = toBase64Url(base64);

  const newUser = {
    telegram_id,
    username,
    wallet: wallet || null,
    tickets: 0,
    payload,
    ...(referred_by && { referred_by }),
  };

  const { data, error } = await supabase
    .from('users')
    .insert([newUser])
    .select();

  if (error) {
    console.error("❌ Ошибка вставки в Supabase:", error.message);
    return res.status(500).json({ error: error.message });
  }

  // После вставки пользователя проверяем наличие отложенных рефералов
  try {
    const { data: pendingRef, error: pendingError } = await supabase
      .from('pending_referrals')
      .select('*')
      .eq('telegram_id', telegram_id)
      .single();

    if (!pendingError && pendingRef) {
      // Обновляем поле referred_by у пользователя
      await supabase
        .from('users')
        .update({ referred_by: pendingRef.referrer_id })
        .eq('telegram_id', telegram_id);

      // Удаляем запись из pending_referrals
      await supabase
        .from('pending_referrals')
        .delete()
        .eq('telegram_id', telegram_id);

      console.log(`✅ Связь с реферером из pending_referrals установлена для пользователя ${telegram_id}`);
    }
  } catch (e) {
    console.error("❌ Ошибка при обработке pending_referrals:", e.message);
  }

  res.status(201).json({
    message: 'User registered',
    user: data?.[0] || null,
  });
};

export default addUser;
