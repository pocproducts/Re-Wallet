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
  /**
   * El link del cobro, tal como lo comparte la app.
   *
   * Es el mismo texto que va dentro del QR —`paymentRequestShareUrl(...)`—, no
   * un formato propio: quien lo escanea o quien lo abre llega al mismo cobro.
   */
  qrPayload?: string;
}
