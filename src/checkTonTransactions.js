import fetch from 'node-fetch';
import handleTransaction from './controllers/users/processPurchase.js';
import { supabase } from './services/supabaseClient.js';
import dotenv from 'dotenv';

dotenv.config();

const TONAPI_KEY = process.env.TONAPI_KEY;
const WALLET_ADDRESS = '0:c452f348330512d374fe3a49c218385c2880038d8fe1c39291974cfc838d4f2a';
const CHECK_INTERVAL = 60_000;

async function getIncomingTransactions() {
  const url = `https://tonapi.io/v2/blockchain/accounts/0:c452f348330512d374fe3a49c218385c2880038d8fe1c39291974cfc838d4f2a/transactions?limit=20`;

  console.log('🔗 URL запроса TonAPI:', url);
  console.log("🔑 TONAPI_KEY:", TONAPI_KEY);

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TONAPI_KEY}`,
    },
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('❌ Ошибка TonAPI:', data);
    return [];
  }

  return data.transactions || [];
}

async function isTxProcessed(tx_hash) {
  const { data, error } = await supabase
    .from('sells')
    .select('id')
    .eq('tx_hash', tx_hash)
    .maybeSingle();

  return !!data;
}

async function checkTransactions() {
  try {
    const transactions = await getIncomingTransactions();

    if (transactions.length === 0) {
      console.log('🔍 Нет новых транзакций.');
      return;
    }

    for (const tx of transactions) {
      const tx_hash = tx.hash;
      const inMsg = tx.in_msg;

      // ✅ Пропустить, если нет входящего сообщения
      if (!inMsg || !inMsg.source?.address || !inMsg.value) continue;

      const sender = inMsg.source.address;
      const destination = inMsg.destination;
      const amountTON = parseInt(inMsg.value) / 1e9;

      // ✅ Только входящие на наш кошелёк
      if (destination !== WALLET_ADDRESS) continue;

      // ✅ Только положительные переводы
      if (amountTON <= 0) continue;

      // ✅ Пропустить, если скам
      if (inMsg.source.is_scam) {
        console.warn(`🚫 Скам-адрес: ${sender} — транзакция пропущена`);
        continue;
      }

      // ✅ Пропустить, если уже обработано
      const already = await isTxProcessed(tx_hash);
      if (already) continue;

      const readableDate = new Date(tx.utime * 1000).toLocaleString();

      console.log(`💸 [${readableDate}] Получено ${amountTON} TON от ${sender}`);
      console.log(`🔗 Хеш транзакции: ${tx_hash}`);

      // ✅ Обработка: начисление билетов
      await handleTransaction(sender, amountTON, tx_hash);
    }
  } catch (error) {
    console.error('❌ Ошибка при обработке транзакций:', error.message);
  }
}

console.log('🚀 Запущен мониторинг транзакций TON...');
setInterval(checkTransactions, CHECK_INTERVAL);
