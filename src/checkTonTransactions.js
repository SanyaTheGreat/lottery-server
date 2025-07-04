import { supabase } from './services/supabaseClient.js';
import fetch from 'node-fetch';
import { Address } from '@ton/core'; // ← нужно установить: npm i @ton/core

const TONCENTER_API_KEY = 'b743eb1d30111124c2f0511d84862922fa1397830913bd2f07cff2fc04217d89'; // замени на свой ключ
const TARGET_WALLET = '0:c452f348330512d374fe3a49c218385c2880038d8fe1c39291974cfc838d4f2a';
const INTERVAL_MS = 60_000;

async function getIncomingTransactions() {
  const url = `https://toncenter.com/api/v2/getTransactions?address=${TARGET_WALLET}&limit=20&api_key=${TONCENTER_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data.ok) throw new Error('Ошибка при получении транзакций');
  return data.result.filter(tx => tx.in_msg?.source && tx.in_msg.value > 0);
}

async function isAlreadyProcessed(txHash) {
  const { data } = await supabase
    .from('sells')
    .select('id')
    .eq('tx_hash', txHash)
    .single();

  return !!data;
}

async function findUserByWallet(wallet) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('wallet', wallet)
    .single();

  return data;
}

async function saveSellRecord({ telegram_id, wallet, amount, tx_hash }) {
  const { error } = await supabase.from('sells').insert([
    {
      telegram_id,
      wallet,
      amount,
      tx_hash,
      status: 'confirmed',
    },
  ]);
  return !error;
}

async function updateUserTickets(telegram_id, amount) {
  const { data: user } = await supabase
    .from('users')
    .select('tickets')
    .eq('telegram_id', telegram_id)
    .single();

  const current = user?.tickets ?? 0;

  await supabase
    .from('users')
    .update({ tickets: current + amount })
    .eq('telegram_id', telegram_id);
}

async function rewardReferrer(telegram_id, amount) {
  const { data: user } = await supabase
    .from('users')
    .select('referrer_id')
    .eq('telegram_id', telegram_id)
    .single();

  if (!user?.referrer_id) return;

  const bonus = amount * 0.1;

  const { data: ref } = await supabase
    .from('users')
    .select('referral_earnings')
    .eq('telegram_id', user.referrer_id)
    .single();

  const current = ref?.referral_earnings ?? 0;

  await supabase
    .from('users')
    .update({ referral_earnings: current + bonus })
    .eq('telegram_id', user.referrer_id);
}

async function processTransactions() {
  try {
    const transactions = await getIncomingTransactions();

    for (const tx of transactions) {
      const txHash = tx.transaction_id.hash;
      const rawSender = tx.in_msg.source;
      const amountTON = parseFloat(tx.in_msg.value) / 1e9;

      if (await isAlreadyProcessed(txHash)) continue;

      // 💡 Преобразование адреса в friendly формат
      const senderFriendly = Address.parse(rawSender).toString({ bounceable: true });

      const user = await findUserByWallet(senderFriendly);
      if (!user) continue;

      await saveSellRecord({
        telegram_id: user.telegram_id,
        wallet: senderFriendly,
        amount: amountTON,
        tx_hash: txHash,
      });

      await updateUserTickets(user.telegram_id, amountTON);
      await rewardReferrer(user.telegram_id, amountTON);

      console.log(`✅ Начислено ${amountTON} билетов для ${senderFriendly}`);
    }
  } catch (err) {
    console.error('Ошибка при обработке транзакций:', err);
  }
}

setInterval(processTransactions, INTERVAL_MS);
console.log('💸 checkTonTransactions.js запущен. Проверка каждые 60 секунд.');
