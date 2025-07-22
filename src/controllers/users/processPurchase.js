import { supabase } from '../../services/supabaseClient.js';

// Проверяем, обработана ли транзакция с таким tx_hash
const isTxProcessed = async (tx_hash) => {
  const { data, error } = await supabase
    .from('sells')
    .select('id')
    .eq('tx_hash', tx_hash)
    .single();

  if (error) {
    // Если ошибка — проверим, что это ошибка "запись не найдена"
    if (error.code === 'PGRST116') {
      return false; // транзакция не найдена, значит не обработана
    }
    console.error('Ошибка при проверке транзакции:', error.message);
    return false;
  }

  return !!data; // true, если транзакция уже есть
};

const handleTransaction = async (telegram_id, amountTON, tx_hash) => {
  // Проверяем, обработана ли уже транзакция
  if (await isTxProcessed(tx_hash)) {
    console.log(`Транзакция ${tx_hash} уже обработана, пропускаем начисление`);
    return;
  }

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegram_id)
    .single();

  if (userError || !userData) {
    console.error('❌ User not found for telegram_id:', telegram_id);
    return;
  }

  const quantity = amountTON;
  const newTicketCount = userData.tickets + quantity;
  const updates = { tickets: newTicketCount };

  const { error: updateError } = await supabase
    .from('users')
    .update(updates)
    .eq('telegram_id', telegram_id);

  if (updateError) {
    console.error('❌ Ошибка обновления пользователя:', updateError.message);
    return;
  }

  const { error: insertError } = await supabase.from('sells').insert([{
    telegram_id,
    wallet: userData.wallet,
    amount: quantity,
    tx_hash: tx_hash,
  }]);

  if (insertError) {
    console.error('❌ Ошибка при сохранении продажи:', insertError.message);
    return;
  }

  console.log(`🎟 Билеты успешно начислены пользователю ${telegram_id}`);
};

export default handleTransaction;
