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

    // Счётчики для статистики
    let total = 0;
    let processedCount = 0;
    let skippedNoInMsg = 0;
    let skippedNotOurAddress = 0;
    let skippedZeroAmount = 0;
    let skippedScam = 0;
    let skippedAlreadyProcessed = 0;
    let skippedBadComment = 0;

    for (const tx of transactions) {
      total++;

      const tx_hash = tx.hash;
      const inMsg = tx.in_msg;

      let comment;
      if (inMsg && inMsg.decoded_op_name === 'text_comment') {
        comment = inMsg.decoded_body?.text?.trim();
      } else {
        comment = undefined;
      }

      if (!inMsg || !inMsg.source?.address || !inMsg.value || !comment) {
        skippedNoInMsg++;
        continue;
      }

      const destination = inMsg.destination?.address;
      if (destination !== WALLET_ADDRESS) {
        skippedNotOurAddress++;
        continue;
      }

      const amountTON = parseInt(inMsg.value) / 1e9;
      if (amountTON <= 0) {
        skippedZeroAmount++;
        continue;
      }

      if (inMsg.source.is_scam) {
        skippedScam++;
        continue;
      }

      const already = await isTxProcessed(tx_hash);
      if (already) {
        skippedAlreadyProcessed++;
        continue;
      }

      const match = comment.match(/^(\d{5,20})$/);
      if (!match) {
        skippedBadComment++;
        continue;
      }

      const telegram_id = match[1];

      await handleTransaction(telegram_id, amountTON, tx_hash);
      processedCount++;
    }

    console.log(`Обработано ${total} транзакций:`);
    console.log(`  - успешно обработано: ${processedCount}`);
    console.log(`  - пропущено (нет in_msg или комментария): ${skippedNoInMsg}`);
    console.log(`  - пропущено (не наш адрес): ${skippedNotOurAddress}`);
    console.log(`  - пропущено (0 TON): ${skippedZeroAmount}`);
    console.log(`  - пропущено (скам-адрес): ${skippedScam}`);
    console.log(`  - пропущено (уже обработано): ${skippedAlreadyProcessed}`);
    console.log(`  - пропущено (некорректный комментарий): ${skippedBadComment}`);

  } catch (error) {
    console.error('❌ Ошибка при обработке транзакций:', error.message);
  }
}

console.log('🚀 Запущен мониторинг транзакций TON...');
setInterval(checkTransactions, CHECK_INTERVAL);
