import { Address, beginCell, Dictionary, contractAddress } from '@ton/core';
import { sign } from '@ton/crypto';

export function walletV5ConfigToCell(config) {
  return beginCell()
    .storeBit(config.signatureAllowed)
    .storeUint(config.seqno, 32)
    .storeUint(config.walletId, 32)
    .storeBuffer(config.publicKey, 32)
    .storeDict(config.extensions, Dictionary.Keys.BigUint(256), Dictionary.Values.BigInt(1))
    .endCell();
}

export const Opcodes = {
  action_send_msg: 0x0ec3c86d,
  action_set_code: 0xad4de08e,
  action_extended_set_data: 0x1ff8ea0b,
  action_extended_add_extension: 0x02,
  action_extended_remove_extension: 0x03,
  action_extended_set_signature_auth_allowed: 0x04,
  auth_extension: 0x6578746e,
  auth_signed: 0x7369676e,
  auth_signed_internal: 0x73696e74
};

export class WalletId {
  static versionsSerialisation = { v5: 0 };

  static deserialize(walletId) {
    // В оригинале: сложное чтение из битов, здесь просто subwalletNumber
    return new WalletId({ networkGlobalId: 0, workChain: 0, walletVersion: 'v5', subwalletNumber: Number(walletId) });
  }

  constructor(args) {
    args = args || {};
    this.networkGlobalId = args.networkGlobalId !== undefined ? args.networkGlobalId : -239;
    this.workChain = args.workChain !== undefined ? args.workChain : 0;
    this.subwalletNumber = args.subwalletNumber !== undefined ? args.subwalletNumber : 0;
    this.walletVersion = args.walletVersion || 'v5';
    this.serialized = BigInt(this.subwalletNumber);
  }
}

export class WalletV5 {
  constructor(address, init) {
    this.address = address;
    this.init = init;
  }

  static createFromAddress(address) {
    return new WalletV5(address);
  }

  static createFromConfig(config, code, workchain = 0) {
    const data = walletV5ConfigToCell(config);
    const init = { code, data };
    return new WalletV5(contractAddress(workchain, init), init);
  }

  async sendDeploy(provider, via, value) {
    await provider.internal(via, {
      value,
      sendMode: 1, // PAY_GAS_SEPARATELY
      body: beginCell().endCell()
    });
  }

  async getPublicKey(provider) {
    const result = await provider.get('get_public_key', []);
    return result.stack.readBigNumber();
  }

  async getSeqno(provider) {
    const state = await provider.getState();
    if (state.state.type === 'active') {
      const res = await provider.get('seqno', []);
      return res.stack.readNumber();
    }
    return 0;
  }

  async getIsSignatureAuthAllowed(provider) {
    const state = await provider.getState();
    if (state.state.type === 'active') {
      const res = await provider.get('is_signature_allowed', []);
      return res.stack.readNumber();
    }
    return -1;
  }

  async getWalletId(provider) {
    const result = await provider.get('get_subwallet_id', []);
    return WalletId.deserialize(result.stack.readBigNumber());
  }

  async getExtensions(provider) {
    const result = await provider.get('get_extensions', []);
    return result.stack.readCellOpt();
  }

  async getExtensionsArray(provider) {
    const extensions = await this.getExtensions(provider);
    if (!extensions) return [];

    const dict = Dictionary.loadDirect(
      Dictionary.Keys.BigUint(256),
      Dictionary.Values.BigInt(1),
      extensions
    );

    return dict.keys().map(key => {
      const wc = this.address.workChain;
      return Address.parseRaw(`${wc}:${key.toString(16).padStart(64, '0')}`);
    });
  }
}
