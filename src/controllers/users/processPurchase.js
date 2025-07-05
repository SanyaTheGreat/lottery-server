// controllers/users/processPurchase.js
import { supabase } from '../../services/supabaseClient.js';

const handleTransaction = async (senderWallet, amountTON, tx_hash) => {
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('*')
    .eq('wallet', senderWallet)
    .single();

  if (userError || !userData) {
    console.error('❌ User not found for wallet:', senderWallet);
    return;
  }

  const quantity = amountTON;
  const newTicketCount = userData.tickets + quantity;
  let updates = { tickets: newTicketCount };

  // ✅ Реферальный бонус — временно отключён по твоему решению
  // if (userData.referred_by) { ... }

  const { error: updateError } = await supabase
    .from('users')
    .update(updates)
    .eq('telegram_id', userData.telegram_id);

  if (updateError) {
    console.error('❌ Ошибка обновления пользователя:', updateError.message);
    return;
  }

  const { error: insertError } = await supabase.from('sells').insert([{
    telegram_id: userData.telegram_id,
    wallet: userData.wallet,
    amount: quantity,
    tx_hash: tx_hash // ✅ сохраняем хеш
  }]);

  if (insertError) {
    console.error('❌ Ошибка при сохранении продажи:', insertError.message);
    return;
  }

  console.log(`🎟 Билеты успешно начислены пользователю ${userData.telegram_id}`);
};

export default handleTransaction;
