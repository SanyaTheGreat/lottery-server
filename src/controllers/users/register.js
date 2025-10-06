import { supabase } from '../../services/supabaseClient.js';
import { beginCell } from '@ton/ton';

// Функция для преобразования base64 в base64url без паддинга
function toBase64Url(base64) {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const addUser = async (req, res) => {
  console.log('📥 [backend] Получен запрос на /users/register');

  const { telegram_id, username, wallet, referrer_id, avatar_url } = req.body;

  if (!telegram_id || !username) {
    return res.status(400).json({ error: 'Username and Telegram ID are required' });
  }

  // Проверяем, есть ли уже пользователь
  const { data: existingUser, error: checkError } = await supabase
    .from('users')
    .select('id')
    .eq('telegram_id', telegram_id)
    .limit(1)
    .maybeSingle();

  if (checkError) {
    console.error('❌ Database check failed:', checkError.message);
    return res.status(500).json({ error: 'Database check failed' });
  }

  let referred_by = null;

  if (referrer_id && referrer_id !== telegram_id) {
    const { data: referrer } = await supabase
      .from('users')
      .select('id')
      .eq('telegram_id', referrer_id)
      .limit(1)
      .maybeSingle();

    if (referrer) referred_by = referrer.id;
  }

  // Генерация payload в формате base64url без паддинга
  const cell = beginCell()
    .storeUint(0, 32)
    .storeStringTail(`${telegram_id}`)
    .endCell();

  const base64 = cell.toBoc().toString('base64');
  const payload = toBase64Url(base64);

  const newUserData = {
    telegram_id,
    username,
    wallet: wallet || null,
    tickets: 0,
    payload,
    avatar_url: avatar_url || null,
    ...(referred_by && { referred_by }),
  };

  // ✅ Если пользователь уже существует → обновляем username и avatar_url
  if (existingUser) {
    const { data: updated, error: updateError } = await supabase
      .from('users')
      .update({
        username,
        avatar_url: avatar_url || null,
      })
      .eq('telegram_id', telegram_id)
      .select();

    if (updateError) {
      console.error('❌ Ошибка обновления:', updateError.message);
      return res.status(500).json({ error: updateError.message });
    }

    return res.status(200).json({
      message: 'User already existed — username updated',
      user: updated?.[0] || null,
    });
  }

  // 🚀 Если нет — создаём нового
  const { data, error } = await supabase
    .from('users')
    .insert([newUserData])
    .select();

  if (error) {
    console.error('❌ Ошибка вставки в Supabase:', error.message);
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json({
    message: 'User registered successfully',
    user: data?.[0] || null,
  });
};

export default addUser;
