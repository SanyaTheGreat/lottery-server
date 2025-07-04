import { supabase } from '../../services/supabaseClient.js';

const createSell = async (req, res) => {
  const { telegram_id, wallet, amount, tx_hash, payload } = req.body;

  if (!telegram_id || !wallet || !amount || !tx_hash) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Проверка на дубликат по tx_hash
  const { data: existing, error: checkError } = await supabase
    .from('sells')
    .select('id')
    .eq('tx_hash', tx_hash)
    .maybeSingle();

  if (checkError) {
    console.error('Ошибка при проверке транзакции:', checkError.message);
    return res.status(500).json({ error: 'Ошибка при проверке транзакции' });
  }

  if (existing) {
    return res.status(409).json({ error: 'Транзакция уже обработана' });
  }

  // Поиск user_id
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id')
    .eq('telegram_id', telegram_id)
    .maybeSingle();

  if (userError || !user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  // Вставка новой записи
  const { error: insertError } = await supabase.from('sells').insert([
    {
      telegram_id,
      user_id: user.id,
      wallet,
      amount,
      status: 'pending',
      tx_hash,
      payload: payload || null,
    },
  ]);

  if (insertError) {
    console.error('Ошибка при сохранении sell:', insertError.message);
    return res.status(500).json({ error: 'Ошибка при сохранении' });
  }

  res.status(201).json({ message: 'Продажа записана' });
};

export default createSell;
