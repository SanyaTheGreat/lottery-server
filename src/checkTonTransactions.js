import fetch from 'node-fetch';
import handleTransaction from './controllers/users/processPurchase.js';
import { supabase } from './services/supabaseClient.js';
import dotenv from 'dotenv';

dotenv.config();

const WALLET_ADDRESS = '0:c452f348330512d374fe3a49c218385c2880038d8fe1c39291974cfc838d4f2a';
const CHECK_INTERVAL = 60_000;
const DEBUG = true;

async function getIncomingTransactions() {
  const url = `https://tonapi.io/v2/blockchain/accounts/${WALLET_ADDRESS}/transactions?limit=20`;
  if (DEBUG) console.log('🔗 URL запроса TonAPI:', url);

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    console.error('❌ Ошибка TonAPI:', data);
    return [];
  }

  return data.transactions || [];
}

async function isTxProcessed(tx_hash) {
  const { data } = await supabase
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
      if (DEBUG) console.log('🔍 Нет новых транзакций.');
      return;
    }

    for (const tx of transactions) {
      const tx_hash = tx.hash;
      const inMsg = tx.in_msg;

      const debugInfo = {
        hash: tx.hash,
        from: inMsg?.source?.address,
        to: inMsg?.destination?.address,
        amount: inMsg?.value,
        comment: inMsg?.comment,
        is_scam: inMsg?.source?.is_scam,
      };
      if (DEBUG) console.log('🔎 Транзакция:', debugInfo);

      if (!inMsg || !inMsg.source?.address || !inMsg.value || !inMsg.comment) {
        if (DEBUG) console.log('⛔ Пропуск: нет in_msg, адреса, значения или комментария');
        continue;
      }

      const destination = inMsg.destination?.address;
      if (destination !== WALLET_ADDRESS) {
        if (DEBUG) console.log('⛔ Пропуск: не наш адрес');
        continue;
      }

      const amountTON = parseInt(inMsg.value) / 1e9;
      if (amountTON <= 0) {
        if (DEBUG) console.log('⛔ Пропуск: 0 TON');
        continue;
      }

      if (inMsg.source.is_scam) {
        console.warn(`🚫 Скам-адрес: ${inMsg.source.address} — транзакция пропущена`);
        continue;
      }

      const already = await isTxProcessed(tx_hash);
      if (already) {
        if (DEBUG) console.log('⛔ Пропуск: уже обработано');
        continue;
      }

      // ✅ Извлекаем telegram_id из комментария
      const comment = inMsg.comment.trim();
      const match = comment.match(/^(\d{5,20})$/);
      if (!match) {
        if (DEBUG) console.log(`⛔ Пропуск: некорректный формат комментария: "${comment}"`);
        continue;
      }

      const telegram_id = match[1];

      const readableDate = new Date(tx.utime * 1000).toLocaleString();
      console.log(`💸 [${readableDate}] Получено ${amountTON} TON от ${inMsg.source.address} (TG ID: ${telegram_id})`);
      console.log(`🔗 Хеш транзакции: ${tx_hash}`);

      await handleTransaction(telegram_id, amountTON, tx_hash);
    }
  } catch (error) {
    console.error('❌ Ошибка при обработке транзакций:', error.message);
  }
}

console.log('🚀 Запущен мониторинг транзакций TON...');
setInterval(checkTransactions, CHECK_INTERVAL);
