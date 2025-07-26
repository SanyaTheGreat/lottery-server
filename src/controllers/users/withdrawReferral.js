import { supabase } from '../../services/supabaseClient.js';
import pkg from 'ton';
import * as tonCrypto from 'ton-crypto';

const { TonClient, WalletContractV4, toNano } = pkg;

async function initProjectWallet() {
  const seedPhrase = process.env.TON_SEED_PHRASE;
  if (!seedPhrase) {
    throw new Error('TON_SEED_PHRASE is not set in environment variables');
  }
  const seedWords = seedPhrase.split(' ');

  const walletKey = await tonCrypto.mnemonicToWalletKey(seedWords, '');

  console.log('walletKey:', walletKey);
  console.log('typeof walletKey.publicKey:', typeof walletKey.publicKey);
  console.log('walletKey.publicKey instanceof Uint8Array:', walletKey.publicKey instanceof Uint8Array);
  console.log('typeof walletKey.secretKey:', typeof walletKey.secretKey);
  console.log('walletKey.secretKey instanceof Uint8Array:', walletKey.secretKey instanceof Uint8Array);

  // walletId с типом bigint
  const walletId = 0n;
  console.log('walletId (as bigint):', walletId, 'type:', typeof walletId);

  const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TON_API_KEY || '',
  });

  // Убираем secretKey из конструктора!
  const wallet = new WalletContractV4({
    client,
    workchain: 0,
    publicKey: walletKey.publicKey,
    walletId: walletId,
  });

  return { wallet, walletKey };
}

async function sendTonTransaction(wallet, walletKey, toAddress, amount) {
  const nanoAmount = toNano(amount.toString());
  console.log('nanoAmount:', nanoAmount, 'typeof nanoAmount:', typeof nanoAmount);

  const balance = await wallet.getBalance();
  if (balance.lt(nanoAmount)) {
    throw new Error('Insufficient project wallet balance');
  }

  const seqno = await wallet.getSeqNo();
  console.log('seqno:', seqno, 'typeof seqno:', typeof seqno);

  const transfer = wallet.createTransfer({
    secretKey: walletKey.secretKey, // Передаем secretKey здесь
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

  return true;
}

const withdrawReferral = async (req, res) => {
  const { telegram_id, wallet: toAddress, amount } = req.body;

  if (!telegram_id || !toAddress || !amount || amount <= 0) {
    return res.status(400).json({ error: 'telegram_id, wallet and positive amount are required' });
  }

  try {
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

    const { wallet, walletKey } = await initProjectWallet();

    await sendTonTransaction(wallet, walletKey, toAddress, amount);

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


////////////////