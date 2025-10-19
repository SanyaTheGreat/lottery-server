import { supabase } from '../../services/supabaseClient.js';

const createSell = async (req, res) => {
  try {
    // 🔐 Пользователь — только из токена
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) return res.status(401).json({ error: 'Unauthorized' });

    // Принимаем только деловые поля от клиента
    const { amount, tx_hash, payload } = req.body || {};

    // Базовая валидация
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (!tx_hash || typeof tx_hash !== 'string' || tx_hash.length < 8) {
      return res.status(400).json({ error: 'Invalid tx_hash' });
    }

    // 1) Ищем пользователя (и его кошелёк) по telegram_id
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, wallet')
      .eq('telegram_id', telegram_id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 2) Проверка на дубликат по tx_hash
    const { data: existing, error: checkError } = await supabase
      .from('sells')
      .select('id')
      .eq('tx_hash', tx_hash)
      .maybeSingle();

    if (checkError) {
      console.error('❌ TX check failed:', checkError.message);
      return res.status(500).json({ error: 'TX check failed' });
    }
    if (existing) {
      return res.status(409).json({ error: 'Transaction already recorded' });
    }

    // 3) Вставка новой записи (источник истины: user из БД)
    const { error: insertError } = await supabase.from('sells').insert([
      {
        telegram_id,          // из токена
        user_id: user.id,     // из БД
        wallet: user.wallet,  // из БД (игнорим, что пришло с клиента)
        amount: amountNum,
        status: 'pending',
        tx_hash,
        payload: payload || null, // опционально
      },
    ]);

    if (insertError) {
      console.error('❌ Insert sell failed:', insertError.message);
      return res.status(500).json({ error: 'Failed to save sell' });
    }

    return res.status(201).json({ message: 'Sale recorded' });
  } catch (err) {
    console.error('❌ createSell unexpected error:', err?.message || err);
    return res.status(500).json({ error: 'Server error' });
  }
};

export default createSell;
