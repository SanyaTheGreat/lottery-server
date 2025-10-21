import { supabase } from '../../services/supabaseClient.js';
import { sendTon } from '../../utils/tonSender.js';

// округление до 9 знаков (TON)
const normAmount = (n) => Number.parseFloat(Number(n).toFixed(9));

const withdrawReferral = async (req, res) => {
  try {
    // 🔐 Пользователь — только из JWT
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) return res.status(401).json({ error: 'Unauthorized' });

    // берём только сумму из тела
    const { amount } = req.body || {};
    const amountNum = Number(amount);

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: 'Некорректная сумма' });
    }
    if (amountNum < 3) {
      return res.status(400).json({ error: 'Минимальная сумма для вывода — 3 TON' });
    }

    // 1) Читаем пользователя (кошелёк и баланс рефералок)
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, wallet, referral_earnings')
      .eq('telegram_id', telegram_id)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    if (!user.wallet) {
      return res.status(400).json({ error: 'Кошелёк не привязан. Сначала добавьте TON-адрес в профиле.' });
    }

    // ⚙️ исправленное вычисление с точностью до 9 знаков
    const available = Math.floor(Number(user.referral_earnings || 0) * 1e9) / 1e9;
    const sum = Math.floor(amountNum * 1e9) / 1e9;

    if (sum > available) {
      return res.status(400).json({ error: 'Недостаточно средств для вывода' });
    }

    // 2) Создаём запись о выводе в статусе pending
    const nowISO = new Date().toISOString();
    const { data: createdWd, error: insErr } = await supabase
      .from('referral_withdrawals')
      .insert([{
        telegram_id,
        user_id: user.id,
        wallet: user.wallet,          // ⚠️ кошелёк берём из БД, не из клиента
        amount: sum,
        status: 'pending',
        created_at: nowISO,
      }])
      .select()
      .single();

    if (insErr) {
      console.error('❌ Insert withdrawal failed:', insErr.message);
      return res.status(500).json({ error: 'Не удалось создать заявку на вывод' });
    }

    // 3) Пытаемся отправить TON
    try {
      await sendTon(user.wallet, sum);
    } catch (sendErr) {
      console.error('❌ sendTon failed:', sendErr?.message || sendErr);

      // помечаем как failed, без списания реф.баланса
      await supabase
        .from('referral_withdrawals')
        .update({ status: 'failed', error_message: String(sendErr?.message || sendErr), failed_at: new Date().toISOString() })
        .eq('id', createdWd.id);

      return res.status(500).json({ error: 'Ошибка отправки TON. Попробуйте позже.' });
    }

    // 4) Атомарно уменьшаем баланс (проверяем, что хватит средств)
    const { data: updatedUser, error: decErr } = await supabase
      .from('users')
      .update({ referral_earnings: normAmount(available - sum) })
      .eq('telegram_id', telegram_id)
      .gte('referral_earnings', sum)
      .select('referral_earnings')
      .single();

    if (decErr || !updatedUser) {
      await supabase
        .from('referral_withdrawals')
        .update({
          status: 'sent_needs_manual_fix',
          error_message: decErr?.message || 'Balance update failed after send',
          confirmed_at: new Date().toISOString()
        })
        .eq('id', createdWd.id);

      return res.status(202).json({
        success: false,
        message: 'TON отправлен, но списание не зафиксировано. Свяжитесь с поддержкой.',
      });
    }

    // 5) Подтверждаем вывод
    await supabase
      .from('referral_withdrawals')
      .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
      .eq('id', createdWd.id);

    return res.status(200).json({
      success: true,
      message: `Успешно отправлено ${sum} TON`,
      new_balance: updatedUser.referral_earnings,
    });
  } catch (err) {
    console.error('❌ withdrawReferral unexpected error:', err);
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
};

export default withdrawReferral;
