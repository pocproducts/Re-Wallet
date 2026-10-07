export interface CryptoAsset {
  id: string;
  name: string;
  ticker: string;
  priceUsd: number;
  change24h: number;
  totalCrypto?: string;
  totalFiat?: string;
  iconBg: string;
  iconText: string;
  networks?: string[];
  depositAddress?: string;
}

export type OperationType = 'buy' | 'sell' | 'deposit' | 'send';
