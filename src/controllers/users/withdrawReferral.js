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

  // Конвертация Buffer в Uint8Array, если нужно
  const publicKey = Uint8Array.from(walletKey.publicKey);
  const secretKey = Uint8Array.from(walletKey.secretKey);

  console.log('typeof publicKey:', typeof publicKey);
  console.log('publicKey instanceof Uint8Array:', publicKey instanceof Uint8Array);

  const walletIdRaw = 0;
  let walletId;
  try {
    walletId = BigInt(walletIdRaw);
  } catch (e) {
    console.error('Error converting walletId to BigInt:', e);
    throw e;
  }

  console.log('walletId (as bigint):', walletId, 'type:', typeof walletId);

  const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TON_API_KEY || '',
  });

  try {
    const wallet = new WalletContractV4({
      client,
      workchain: 0,
      publicKey,
      walletId,
    });
    return { wallet, secretKey };
  } catch (e) {
    console.error('Error creating WalletContractV4:', e);
    throw e;
  }
}

async function sendTonTransaction(wallet, secretKey, toAddress, amount) {
  const nanoAmount = toNano(amount.toString());
  console.log('nanoAmount:', nanoAmount, 'typeof nanoAmount:', typeof nanoAmount);

  const balance = await wallet.getBalance();
  console.log('wallet balance:', balance.toString());

  if (balance.lt(nanoAmount)) {
    throw new Error('Insufficient project wallet balance');
  }

  const seqno = await wallet.getSeqNo();
  console.log('seqno:', seqno, 'typeof seqno:', typeof seqno);

  const transfer = wallet.createTransfer({
    secretKey, // Передаем secretKey здесь
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

  console.log('Withdraw request:', { telegram_id, toAddress, amount });

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

    const { wallet, secretKey } = await initProjectWallet();

    await sendTonTransaction(wallet, secretKey, toAddress, amount);

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
