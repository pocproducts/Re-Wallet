export interface TransactionItem {
  id: string;
  title: string;
  date: string;
  amount: string;
  isPositive: boolean;
  type: 'ars' | 'trx' | 'doge' | 'sol' | 'btc' | 'usdt' | 'usdc' | 'qr_charge';
  section: 'Hoy' | 'Anteriores';
  concept?: string;
  status?: string;
  expiresAt?: string;
  qrPayload?: string;
}
