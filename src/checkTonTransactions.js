import fetch from 'node-fetch';
import handleTransaction from './controllers/users/processPurchase.js';
import { supabase } from './services/supabaseClient.js';
import dotenv from 'dotenv';
import { Cell } from '@ton/core';

dotenv.config();

const WALLET_ADDRESS = '0:c452f348330512d374fe3a49c218385c2880038d8fe1c39291974cfc838d4f2a';
const CHECK_INTERVAL = 60_000;
const DEBUG = true;

function decodeTelegramIdFromPayload(payloadBase64) {
  try {
    const payloadBuffer = Buffer.from(payloadBase64, 'base64');
    const cell = Cell.fromBoc(payloadBuffer)[0];
    const slice = cell.beginParse();
    const telegramId = slice.loadUintBig(64).toString();
    return telegramId;
  } catch (e) {
    console.error('❌ Ошибка при декодировании payload:', e.message);
    return null;
  }
}

async function getIncomingTransactions() {
  const url = `https://tonapi.io/v2/blockchain/accounts/${WALLET_ADDRESS}/transactions?limit=20`;
  console.log('🔗 URL запроса TonAPI:', url);

  const res = await fetch(url);
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

      const debugInfo = {
        hash: tx.hash,
        from: inMsg?.source?.address,
        to: inMsg?.destination?.address,
        amount: inMsg?.value,
        payload: inMsg?.payload,
        is_scam: inMsg?.source?.is_scam,
      };
      if (DEBUG) console.log('🔎 Транзакция:', debugInfo);

      if (!inMsg || !inMsg.source?.address || !inMsg.value || !inMsg.payload) {
        if (DEBUG) console.log('⛔ Пропуск: нет in_msg, адреса, значения или payload');
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

      const telegram_id = decodeTelegramIdFromPayload(inMsg.payload);
      if (!telegram_id) {
        if (DEBUG) console.log('⛔ Пропуск: не удалось декодировать telegram_id');
        continue;
      }

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
