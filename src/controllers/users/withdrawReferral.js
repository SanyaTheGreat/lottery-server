import { supabase } from '../../services/supabaseClient.js';
import { TonClient, WalletContractV4, KeyPair, toNano } from 'ton';

// Функция инициализации кошелька проекта на базе seed-фразы
async function initProjectWallet() {
  const seedPhrase = process.env.TON_SEED_PHRASE;
  if (!seedPhrase) {
    throw new Error('TON_SEED_PHRASE is not set in environment variables');
  }
  const seedWords = seedPhrase.split(' ');

  // Конвертация seed-фразы в seed (32 байта)
  const bip39 = await import('bip39');
  const seedBuffer = await bip39.mnemonicToSeed(seedWords.join(' '));
  const seed = seedBuffer.slice(0, 32);

  const keyPair = KeyPair.fromSeed(seed);

  const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC', // или свой RPC
    apiKey: process.env.TON_API_KEY || '', // если нужен ключ API
  });

  const wallet = new WalletContractV4({
    client,
    workchain: 0,
    publicKey: keyPair.publicKey,
    walletId: 0,
    secretKey: keyPair.secretKey,
  });

  return wallet;
}

// Функция отправки TON
async function sendTonTransaction(wallet, toAddress, amount) {
  const nanoAmount = toNano(amount.toString()); // перевод в нанотонны

  // Проверяем баланс кошелька проекта
  const balance = await wallet.getBalance();
  if (balance.lt(nanoAmount)) {
    throw new Error('Insufficient project wallet balance');
  }

  // Создаём и отправляем транзакцию
  const seqno = await wallet.getSeqNo();

  const transfer = wallet.createTransfer({
    secretKey: wallet.secretKey,
    seqno,
    sendMode: 3,
    order: [
      {
        amount: nanoAmount,
        address: toAddress,
        payload: null,
      },
    ],
  });

  await wallet.client.sendExternalMessage(wallet.address, transfer);

  return true; // можно расширить, например, вернуть хэш транзакции
}

const withdrawReferral = async (req, res) => {
  const { telegram_id, wallet: toAddress, amount } = req.body;

  if (!telegram_id || !toAddress || !amount || amount <= 0) {
    return res.status(400).json({ error: 'telegram_id, wallet and positive amount are required' });
  }

  try {
    // Получаем реферальный баланс пользователя
    const { data: user, error } = await supabase
      .from('users')
      .select('referral_earnings')
      .eq('telegram_id', telegram_id)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.referral_earnings < amount) {
      return res.status(400).json({ error: 'Insufficient referral balance' });
    }

    // Инициализируем кошелёк проекта
    const projectWallet = await initProjectWallet();

    // Отправляем TON
    await sendTonTransaction(projectWallet, toAddress, amount);

    // После успешной отправки — уменьшаем баланс реферальных начислений
    const { error: updateError } = await supabase
      .from('users')
      .update({ referral_earnings: user.referral_earnings - amount })
      .eq('telegram_id', telegram_id);

    if (updateError) {
      return res.status(500).json({ error: 'Failed to update referral earnings' });
    }

    return res.json({ message: 'Withdrawal successful' });
  } catch (e) {
    console.error('TON transfer error:', e);
    return res.status(500).json({ error: 'Failed to send TON transaction: ' + e.message });
  }
};

export default withdrawReferral;
