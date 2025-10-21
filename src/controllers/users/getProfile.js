import { supabase } from '../../services/supabaseClient.js';

const DAYS_LOCK = 21;

const getProfile = async (req, res) => {
  try {
    const telegram_id = req.user?.telegram_id;
    if (!telegram_id) {
      return res.status(401).json({ error: 'Unauthorized: no telegram_id in token' });
    }

    // 1) сам пользователь (+ id понадобиться для связки рефералок)
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, telegram_id, username, wallet, tickets, payload, avatar_url')
      .eq('telegram_id', telegram_id)
      .single();

    if (userErr || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 2) все начисления рефералок этому пользователю
    const { data: earns, error: earnsErr } = await supabase
      .from('referral_earnings')
      .select('amount, created_at')
      .eq('referrer_id', user.id);

    if (earnsErr) {
      console.error('referral_earnings error:', earnsErr.message);
      return res.status(500).json({ error: 'Failed to load referral earnings' });
    }

    // суммы в JS (numeric → Number)
    const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const totalAll = (earns || []).reduce((s, r) => s + toNum(r.amount), 0);

    // разблокированные (старше 21 дня)
    const cutoff = Date.now() - DAYS_LOCK * 24 * 60 * 60 * 1000;
    const unlockedRaw = (earns || [])
      .filter((r) => new Date(r.created_at).getTime() <= cutoff)
      .reduce((s, r) => s + toNum(r.amount), 0);

    // 3) подтверждённые или зафиксированные выводы (что уже списано)
    const { data: wds, error: wdErr } = await supabase
      .from('referral_withdrawals')
      .select('amount, status')
      .eq('telegram_id', telegram_id)
      .in('status', ['confirmed', 'sent_needs_manual_fix']); // учитывать успешно отправленные

    if (wdErr) {
      console.error('referral_withdrawals error:', wdErr.message);
      return res.status(500).json({ error: 'Failed to load withdrawals' });
    }

    const withdrawn = (wds || []).reduce((s, r) => s + toNum(r.amount), 0);

    // 4) доступно и заморожено
    const can = Math.max(0, unlockedRaw - withdrawn);
    const frozen = Math.max(0, totalAll - can - withdrawn); // просто для справки

    // (опционально) минимальная сумма для кнопки может считаться на фронте
    const withdraw_available = can >= 3; // если у тебя мин.порог 3 TON

    return res.status(200).json({
      telegram_id: user.telegram_id,
      username: user.username,
      wallet: user.wallet,
      tickets: user.tickets,
      payload: user.payload,
      avatar_url: user.avatar_url,

      // новое:
      referral_total: Number(totalAll.toFixed(9)),
      referral_can: Number(can.toFixed(9)),
      referral_frozen: Number(frozen.toFixed(9)),

      withdraw_available,
    });
  } catch (err) {
    console.error('❌ Error in getProfile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export default getProfile;
