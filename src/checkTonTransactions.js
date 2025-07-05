import fetch from 'node-fetch';
import { handleTransaction } from './controllers/users/processPurchase.js';
import { supabase } from './services/supabaseClient.js';
import dotenv from 'dotenv';

dotenv.config();

const TONAPI_KEY = process.env.TONAPI_KEY;
const WALLET_ADDRESS = '0:c452f348330512d374fe3a49c218385c2880038d8fe1c39291974cfc838d4f2a';

async function getIncomingTransactions() {
  const url = `https://tonapi.io/v2/blockchain/accounts/${WALLET_ADDRESS}/transactions?limit=20`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TONAPI_KEY}`,
    },
  });

  const data = await res.json();

  if (!res.ok) {
    console.error('Ошибка TonAPI:', data);
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

    for (const tx of transactions) {
      const tx_hash = tx.tx_hash;
      const from = tx.in_msg?.source;
      const amount = parseInt(tx.in_msg?.value || '0') / 1e9;

      if (!from || amount <= 0) continue;

      const already = await isTxProcessed(tx_hash);
      if (already) continue;

      console.log(`💰 Получено ${amount} TON от ${from}`);

      await handleTransaction(from, amount, tx_hash); // передаём хеш транзакции

    }
  } catch (error) {
    console.error('❌ Ошибка при обработке транзакций:', error.message);
  }
}

setInterval(checkTransactions, 60_000);
