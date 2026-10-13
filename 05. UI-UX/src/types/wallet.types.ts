export interface WalletBalance {
  fiatArs: number;
  digitalDollarsUsdc: number;
  cryptoTotalUsd: number;
  yieldAnnualRate: number;
}

export type ActionModalType = 'depositar' | 'usar' | 'enviar' | null;
export type NavTab = 'wallet' | 'investments' | 'activity';
