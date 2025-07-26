import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const withdrawReferral = async (req, res) => {
  const { telegram_id, wallet, amount } = req.body;

  // Проверка входных данных
  if (!telegram_id || !wallet || !amount) {
    return res.status(400).json({ error: 'Недостаточно данных для запроса' });
  }

  if (amount < 3) {
    return res.status(400).json({ error: 'Минимальная сумма для вывода — 3 TON' });
  }

  try {
    // Получаем пользователя по telegram_id
    const { data: user, error } = await supabase
      .from('users')
      .select('referral_earnings')
      .eq('telegram_id', telegram_id)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    if (amount > user.referral_earnings) {
      return res.status(400).json({ error: 'Недостаточно средств для вывода' });
    }

    const newBalance = user.referral_earnings - amount;

    // Обновляем баланс в Supabase
    const { error: updateError } = await supabase
      .from('users')
      .update({ referral_earnings: newBalance })
      .eq('telegram_id', telegram_id);

    if (updateError) {
      return res.status(500).json({ error: 'Ошибка при обновлении баланса' });
    }

    // Пока что просто логируем успешный вывод (реальная отправка позже)
    console.log(`✅ Вывод ${amount} TON на кошелёк ${wallet}`);

    return res.status(200).json({
      success: true,
      message: `Успешно отправлено ${amount} TON`,
      new_balance: newBalance,
    });

  } catch (err) {
    console.error('Ошибка обработки запроса на вывод:', err);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};

export default withdrawReferral;
