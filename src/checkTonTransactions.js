import fetch from 'node-fetch';
import handleTransaction from './controllers/users/processPurchase.js';
import { supabase } from './services/supabaseClient.js';
import dotenv from 'dotenv';

dotenv.config();

const WALLET_ADDRESS = '0:c452f348330512d374fe3a49c218385c2880038d8fe1c39291974cfc838d4f2a';
const CHECK_INTERVAL = 60_000;
const DEBUG = true;

/* ===== helpers: scanner_state (таблица с key='last_lt') ===== */

async function getLastLT() {
  const { data, error } = await supabase
    .from('scanner_state')
    .select('value')
    .eq('key', 'last_lt')
    .maybeSingle();

  if (error) {
    console.error('❌ scanner_state read error:', error);
    return 0n;
  }
  const v = data?.value ?? '0';
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}

async function setLastLT(ltBigInt) {
  const value = ltBigInt.toString();
  const { error } = await supabase
    .from('scanner_state')
    .upsert({ key: 'last_lt', value }, { onConflict: 'key' });
  if (error) console.error('❌ scanner_state write error:', error);
  else if (DEBUG) console.log('✅ last_lt updated to', value);
}

/* ===================== TonAPI (без ключа) ===================== */

async function fetchTransactions({ before_lt = null, limit = 50 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), archival: 'true' });
  if (before_lt) params.set('before_lt', String(before_lt));
  const url = `https://tonapi.io/v2/blockchain/accounts/${WALLET_ADDRESS}/transactions?${params.toString()}`;
  if (DEBUG) console.log('🔗 TonAPI:', url);

  const res = await fetch(url);
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }

  if (!res.ok) {
    console.error('❌ TonAPI error:', data);
    return [];
  }
  return data.transactions || [];
}

/* ============== твои текущие хелперы без изменений ============== */

async function isTxProcessed(tx_hash) {
  const { data } = await supabase
    .from('sells')
    .select('id')
    .eq('tx_hash', tx_hash)
    .maybeSingle();
  return !!data;
}

/* ========================== main ========================== */

async function scanOnce() {
  // читаем сохранённый last_lt
  const lastLT = await getLastLT();
  if (DEBUG) console.log('ℹ️ last_lt =', lastLT.toString());

  // Первый запуск: не обрабатываем историю, просто ставим baseline
  if (lastLT === 0n) {
    const firstPage = await fetchTransactions({ limit: 1 });
    if (firstPage.length) {
      const baseline = BigInt(firstPage[0].lt);
      await setLastLT(baseline);
      if (DEBUG) console.log('🧩 First run baseline set to', baseline.toString());
    }
    return;
  }

  // Берём свежие транзакции до last_lt (движение назад) и оставляем только те, у которых lt > last_lt
  const page = await fetchTransactions({ before_lt: null, limit: 50 }); // верхняя страница
  const news = page.filter(tx => {
    try { return BigInt(tx.lt) > lastLT; } catch { return false; }
  });

  if (!news.length) {
    if (DEBUG) console.log('🔍 Новых транзакций нет (по last_lt).');
    return;
  }

  // Обрабатываем по возрастанию lt
  news.sort((a, b) => {
    const la = BigInt(a.lt), lb = BigInt(b.lt);
    return la < lb ? -1 : la > lb ? 1 : 0;
  });

  // counters
  let total = 0;
  let processedCount = 0;
  let skippedNoInMsg = 0;
  let skippedNotOurAddress = 0;
  let skippedZeroAmount = 0;
  let skippedScam = 0;
  let skippedAlreadyProcessed = 0;
  let skippedBadComment = 0;

  let maxLtProcessed = lastLT;

  for (const tx of news) {
    total++;

    const tx_hash = tx.hash;
    const inMsg = tx.in_msg;

    // ⚠️ как было у тебя — не меняем
    let comment;
    if (inMsg && inMsg.decoded_op_name === 'text_comment') {
      comment = inMsg.decoded_body?.text?.trim();
    } else {
      comment = undefined;
    }

    const txLt = BigInt(tx.lt);
    if (txLt > maxLtProcessed) maxLtProcessed = txLt;

    if (!inMsg || !inMsg.source?.address || !inMsg.value || !comment) {
      skippedNoInMsg++;
      continue;
    }

    const destination = inMsg.destination?.address;
    if (destination !== WALLET_ADDRESS) {
      skippedNotOurAddress++;
      continue;
    }

    const amountTON = Number(inMsg.value) / 1e9;
    if (!Number.isFinite(amountTON) || amountTON <= 0) {
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

  // Сдвигаем last_lt вперёд до максимального увиденного
  if (maxLtProcessed > lastLT) {
    await setLastLT(maxLtProcessed);
  }

  console.log(`Обработано новых (по last_lt) ${total} транзакций:`);
  console.log(`  - успешно обработано: ${processedCount}`);
  console.log(`  - пропущено (нет in_msg/коммента): ${skippedNoInMsg}`);
  console.log(`  - пропущено (не наш адрес): ${skippedNotOurAddress}`);
  console.log(`  - пропущено (0 TON): ${skippedZeroAmount}`);
  console.log(`  - пропущено (скам-адрес): ${skippedScam}`);
  console.log(`  - пропущено (уже обработано): ${skippedAlreadyProcessed}`);
  console.log(`  - пропущено (некорректный комментарий): ${skippedBadComment}`);
}

console.log('🚀 Запущен мониторинг транзакций TON...');
setInterval(scanOnce, CHECK_INTERVAL);
