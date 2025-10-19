import { supabase } from '../../services/supabaseClient.js';

// Работаем с 9 знаками после запятой безопасно
const toNano = (val) => BigInt(Math.round(Number(val) * 1e9));
const fromNano = (nano) => (Number(nano) / 1e9).toFixed(9);

/**
 * Пытаемся зафиксировать транзакцию в sells по уникальному tx_hash.
 * Возвращает { inserted: true, row } если вставили новую;
 * { inserted: false } если уже была.
 */
async function upsertSell({ telegram_id, wallet, amount, tx_hash }) {
  // В Supabase upsert с onConflict + ignoreDuplicates даёт идемпотентность
  const { data, error } = await supabase
    .from('sells')
    .upsert(
      [{ telegram_id, wallet, amount, tx_hash }],
      { onConflict: 'tx_hash', ignoreDuplicates: true }
    )
    .select();

  if (error) {
    // Если уникальный индекс уже есть и конфликт сработал, data может быть пустым — это ок
    // Любые другие ошибки логируем/прокидываем
    if (error.code && String(error.code).startsWith('23')) {
      // уникальный конфликт — считаем "уже было"
      return { inserted: false };
    }
    throw error;
  }

  // Когда ignoreDuplicates: true и запись уже существовала — data, как правило, пустой массив
  if (!data || data.length === 0) {
    return { inserted: false };
  }
  return { inserted: true, row: data[0] };
}

const handleTransaction = async (telegram_id, amountTON, tx_hash) => {
  try {
    // 0) Валидация входных
    if (!telegram_id || !tx_hash || !Number.isFinite(Number(amountTON)) || Number(amountTON) <= 0) {
      console.error('❌ Invalid transaction payload', { telegram_id, amountTON, tx_hash });
      return;
    }

    // 1) Находим пользователя (для кошелька + проверки существования)
    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, wallet, tickets')
      .eq('telegram_id', telegram_id)
      .single();

    if (userErr || !user) {
      console.error('❌ User not found for telegram_id:', telegram_id, userErr?.message);
      return;
    }

    // 2) Переводим amount к каноническому виду (9 знаков), чтобы не плодить разные форматы
    const amountNano = toNano(amountTON);
    const amountNormalized = fromNano(amountNano); // string с 9 знаками: "0.100000000"

    // 3) Сначала фиксируем транзакцию в sells (идемпотентно по tx_hash)
    const upsertRes = await upsertSell({
      telegram_id,
      wallet: user.wallet || null,
      amount: amountNormalized,
      tx_hash
    });

    if (!upsertRes.inserted) {
      console.log(`ℹ️ TX ${tx_hash} already processed — skipping credit`);
      return;
    }

    // 4) Атомарно начисляем тикеты пользователю
    //    Пытаемся через RPC (предпочтительно), если функции нет — fallback.
    const { error: rpcErr } = await supabase.rpc('add_tickets_by_telegram', {
      p_telegram_id: telegram_id,
      p_amount: amountNormalized
    });

    if (rpcErr) {
      console.warn('⚠️ RPC add_tickets_by_telegram unavailable, fallback to update:', rpcErr.message);

      // Fallback: прочитать текущее и обновить — аккуратно в десятичной арифметике
      const currentNano = toNano(user.tickets || 0);
      const newNano = currentNano + amountNano;
      const newStr = fromNano(newNano);

      const { error: updErr } = await supabase
        .from('users')
        .update({ tickets: newStr })
        .eq('telegram_id', telegram_id);

      if (updErr) {
        console.error('❌ Failed to update tickets (fallback):', updErr.message);
        return;
      }
    }

    console.log(`✅ Tickets credited: +${amountNormalized} to ${telegram_id} (tx ${tx_hash})`);
  } catch (e) {
    console.error('❌ handleTransaction error:', e?.message || e);
  }
};

export default handleTransaction;
