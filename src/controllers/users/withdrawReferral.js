import { supabase } from '../../services/supabaseClient.js';
import pkg from '@ton/ton';
import * as tonCrypto from 'ton-crypto';
import { Cell, Address } from '@ton/core';
import { WalletV5, walletV5ConfigToCell } from './wallet-v5.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const { TonClient, toNano, fromNano } = pkg;

// Получаем текущую директорию файла для корректного чтения wallet_v5_code.b64
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Загружаем байткод контракта WalletV5 из base64 файла
async function loadWalletCode() {
  const base64Path = path.resolve(__dirname, 'wallet_v5_code.b64');
  console.log('Loading wallet code from:', base64Path);

  const base64 = await fs.readFile(base64Path, 'utf-8');
  const buffer = Buffer.from(base64, 'base64');
  const cells = Cell.fromBoc(buffer);
  return cells[0];
}

async function initProjectWallet() {
  const seedPhrase = process.env.TON_SEED_PHRASE;
  if (!seedPhrase) {
    throw new Error('TON_SEED_PHRASE is not set in environment variables');
  }
  const seedWords = seedPhrase.split(' ');

  const walletKey = await tonCrypto.mnemonicToWalletKey(seedWords, '');

  const walletId = 0n;

  const client = new TonClient({
    endpoint: 'https://toncenter.com/api/v2/jsonRPC',
    apiKey: process.env.TON_API_KEY || '',
  });

  const walletCode = await loadWalletCode();

  const walletConfig = {
    signatureAllowed: true,
    seqno: 0,
    walletId,
    publicKey: walletKey.publicKey,
    extensions: new Map(),
  };

  const wallet = WalletV5.createFromConfig(walletConfig, walletCode, 0);

  wallet.client = client;

  console.log('Initialized project wallet address:', wallet.address.toString());

  return { wallet, walletKey };
}

async function sendTonTransaction(wallet, walletKey, toAddressStr, amount) {
  const nanoAmount = toNano(amount.toString());
  console.log(`Requested transfer amount: ${amount} TON (${nanoAmount.toString()} nano)`);

  // Получаем баланс кошелька через клиента TON напрямую
  const balanceNanoStr = await wallet.client.getBalance(wallet.address);
  const balanceNano = BigInt(balanceNanoStr);
  console.log(`Project wallet balance: ${fromNano(balanceNano)} TON (${balanceNanoStr} nano)`);

  if (balanceNano < nanoAmount) {
    throw new Error('Insufficient project wallet balance');
  }

  // Получаем seqno через контракт провайдера (wallet.client)
  const provider = await wallet.client.getContractProvider(wallet.address);
  const seqno = await wallet.getSeqno(provider);
  console.log('Current wallet seqno:', seqno);

  const toAddress = Address.parseFriendly(toAddressStr).address;

  const transfer = wallet.createTransfer({
    secretKey: walletKey.secretKey,
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

  console.log('Sending transfer message...');

  // Отправляем внешнее сообщение через провайдера
  await provider.external(transfer);

  console.log('Transfer sent successfully');

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
