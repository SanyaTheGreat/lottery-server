import { supabase } from '../../services/supabaseClient.js';
import { Buffer } from 'buffer';

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

  // ✅ Генерация простого читаемого payload
  let payload = null;
  try {
    const plainText = `tg:${telegram_id}`;
    payload = Buffer.from(plainText, 'utf-8').toString('base64');
  } catch (e) {
    console.error('❌ Ошибка генерации payload:', e.message);
    return res.status(500).json({ error: 'Payload generation failed' });
  }

  const newUser = {
    telegram_id,
    username,
    wallet: wallet || null,
    tickets: 0,
    payload
  };

  if (referred_by) {
    newUser.referred_by = referred_by;
  }

  const { data, error } = await supabase
    .from('users')
    .insert([newUser])
    .select();

  if (error) {
    console.error("❌ Ошибка вставки в Supabase:", error.message);
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json({
    message: 'User registered',
    user: data?.[0] || null
  });
};

export default addUser;
