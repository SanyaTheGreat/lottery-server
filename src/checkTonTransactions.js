import fetch from 'node-fetch';
import { handleTransaction } from './controllers/users/buyTickets.js'; // если ты обрабатываешь покупки
import dotenv from 'dotenv';

dotenv.config();

const TONAPI_KEY = process.env.TONAPI_KEY || 'AGRLZGBRUVZFQPIAAAAG35EJ5BX0MDGMUZCASSBUUYAHUXLFR4GIXDZQVDF16U2QFBUJ7CY';
const WALLET_ADDRESS = '0:c452f348330512d374fe3a49c218385c2880038d8fe1c39291974cfc838d4f2a'; // RAW
let processedTxs = new Set();

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

async function checkTransactions() {
  try {
    const transactions = await getIncomingTransactions();

    for (const tx of transactions) {
      if (!tx.in_msg?.value || processedTxs.has(tx.tx_hash)) continue;

      const from = tx.in_msg.source;
      const amount = parseInt(tx.in_msg.value) / 1e9;

      console.log(`💰 Получено ${amount} TON от ${from}`);

      // Вызов логики начисления билетов
      await handleTransaction(from, amount);

      processedTxs.add(tx.tx_hash);
    }
  } catch (error) {
    console.error('❌ Ошибка при обработке транзакций:', error.message);
  }
}

setInterval(checkTransactions, 60_000); // каждые 60 сек
