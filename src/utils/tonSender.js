import axios from 'axios';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV4, internal, TonClient, toNano } from '@ton/ton';
import { getHttpEndpoint } from '@orbs-network/ton-access';

const TON_SEED_PHRASE = process.env.TON_SEED_PHRASE;
const TON_API_KEY = process.env.TON_API_KEY;
const MIN_GAS_TON = 0.03;

export async function sendTon(toAddress, amountTon) {
  if (!TON_SEED_PHRASE || !TON_API_KEY) {
    throw new Error('TON_SEED_PHRASE или TON_API_KEY не указаны в .env');
  }

  const mnemonicArray = TON_SEED_PHRASE.trim().split(/\s+/);
  const keyPair = await mnemonicToPrivateKey(mnemonicArray);

  const endpoint = await getHttpEndpoint();
  const client = new TonClient({ endpoint });

  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  const sender = client.open(wallet);

  const seqno = await sender.getSeqno();

  const tonToSend = amountTon - MIN_GAS_TON;
  if (tonToSend <= 0) throw new Error('Недостаточно TON для учёта комиссии');

  console.log(`📤 Отправка ${tonToSend} TON → ${toAddress} (seqno: ${seqno})`);

  await sender.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to: toAddress,
        value: toNano(tonToSend), // ✅ без строки, только число
        body: 'Referral withdrawal',
      }),
    ],
  });

  console.log('✅ Транзакция отправлена через Toncenter');
}
