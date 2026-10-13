/**
 * Financial transactions: the authenticated person's money movements.
 *
 * Each transaction represents a change in a specific asset balance.
 * For example, a swap of USDC for TRX generates two transactions:
 *   -1.00 USDC (expense) and +2.50 TRX (income).
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * Before this, the ActivityView showed only mock data or empty state. Now it shows
 * real financial movements from the user's history, enabling them
 * to see each income and expense of money.
 *
 * The transaction list is built from webhook events, filtered for those that
 * represent actual money movements and converted to the format expected by
 * the ActivityView.
 *
 * ── How transactions are defined ─────────────────────────────────────────────
 *
 * A transaction represents a change in balance of a specific asset.
 * This includes:
 *   - Deposits/withdrawals: change in asset balance
 *   - Sends/receives: change in asset balance
 *   - Swaps: two transactions (source asset decrease, destination asset increase)
 *   - Yield earnings/fees: change in asset balance
 *   - Other platform movements: changes in asset balance
 */
import type { NotificationCategory } from '../../domain/webhooks/eventDescription';
import { describeFinancialEvent } from '../../domain/webhooks/eventDescription';
import type { WebhookEventStore } from '../../domain/ports/webhook-event-store';
import type { Logger } from '../../domain/ports/logger';
import { noopLogger } from '../../domain/ports/logger';

/** A transaction feed is a screen, not an archive. */
export const TRANSACTIONS_PAGE_SIZE = 50;

export interface TransactionItem {
  /** Identificador único de la transacción. */
  readonly id: string;
  /** Título corto de la transacción. */
  readonly title: string;
  /** Fecha de la transacción. */
  readonly date: string;
  /** Monto formateado con signo y moneda (ej: "+ 7,193689 TRX"). */
  readonly amount: string;
  /** Indica si la transacción es un ingreso (true) o egreso (false). */
  readonly isPositive: boolean;
  /** Tipo de activo o transacción (usado para iconos: 'usdc', 'trx', etc.). */
  readonly type: string;
  /** Descripción opcional de la transacción. */
  readonly concept?: string;
  /** Fecha de expiración para cobros QR. */
  readonly expiresAt?: string;
  /** Payload del código QR para cobros QR. */
  readonly qrPayload?: string;
  /** Firma de la transacción en Solana (para ver en explorador). */
  readonly signature?: string;
  /** Sección de la transacción: 'Hoy' o 'Anteriores'. */
  readonly section?: 'Hoy' | 'Anteriores';
}

export interface TransactionsResponse {
  /** Timestamp de cuando se generó el feed, o null si no está disponible. */
  readonly generatedAt: string | null;
  /** Lista de transacciones, del más nuevo al más viejo. */
  readonly transactions: TransactionItem[];
}

/** Raised when the rows cannot be read at all: 502, never an empty feed. */
export class TransactionsUnavailable extends Error {
  constructor(cause: unknown) {
    super('the transaction rows could not be read', { cause });
    this.name = 'TransactionsUnavailable';
  }
}

export type GetTransactions = (privyDid: string) => Promise<TransactionsResponse>;

export const getTransactions = (deps: {
  readonly store: WebhookEventStore;
  readonly log?: Logger;
  readonly pageSize?: number;
}): GetTransactions => {
  const log = deps.log ?? noopLogger;
  const pageSize = deps.pageSize ?? TRANSACTIONS_PAGE_SIZE;

  return async (privyDid) => {
    let rows;
    try {
      rows = await deps.store.listForPerson(privyDid, pageSize);
    } catch (error) {
      // An empty feed is a **claim**: "you have no transactions". A failed read
      // is not that, and reporting it as 200 would make an outage look like a
      // quiet account.
      log.error('GET /transactions could not read the webhook rows', error);
      throw new TransactionsUnavailable(error);
    }

    // Convert webhook events to transaction items
    const transactions = rows
      .filter(isFinancialEvent)
      .flatMap(createTransactionItems); // flatMap because one event can generate multiple items

    // Sort newest first
    transactions.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return {
      generatedAt: new Date().toISOString(),
      transactions,
    };
  };
};

/** Determines if a webhook event represents a financial transaction. */
function isFinancialEvent(event: { eventType: string; payload: unknown }): boolean {
  // List of event types that represent actual money movements
  const FINANCIAL_EVENT_TYPES = new Set([
    // Deposits/withdrawals
    'wallet.funds_deposited',
    'wallet.funds_withdrawn',
    
    // Sends/receives
    'wallet.funds_sent',
    'wallet.funds_received',
    
    // Swaps/trades
    'wallet.asset_swapped',
    'wallet.asset_bought',
    'wallet.asset_sold',
    
    // Yield/earnings
    'wallet.yield_earned',
    'wallet.yield_fees_paid',
    
    // Other platform movements
    'wallet.funds_converted', // internal conversions
    'wallet.funds_locked',    // for staking, etc.
    'wallet.funds_unlocked',
    
    // Charge/payment requests
    'payment.request_fulfilled',
  ]);
  
  return FINANCIAL_EVENT_TYPES.has(event.eventType);
}

/**
 * Convierte un evento financiero webhook en uno o más elementos de transacción.
 *
 * Un evento puede generar múltiples transacciones cuando afecta a varios activos
 * (ej: un swap disminuye un activo y aumenta otro).
 */
function createTransactionItems(event: {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}): TransactionItem[] {
  switch (event.eventType) {
    case 'wallet.funds_deposited':
      return createDepositTransaction(event);
    case 'wallet.funds_withdrawn':
      return createWithdrawalTransaction(event);
    case 'wallet.funds_sent':
      return createSentTransaction(event);
    case 'wallet.funds_received':
      return createReceivedTransaction(event);
    case 'wallet.asset_swapped':
      return createSwapTransactions(event);
    case 'wallet.asset_bought':
      return createBoughtTransaction(event);
    case 'wallet.asset_sold':
      return createSoldTransaction(event);
    case 'wallet.yield_earned':
      return createYieldEarnedTransaction(event);
    case 'wallet.yield_fees_paid':
      return createYieldFeesPaidTransaction(event);
    case 'wallet.funds_converted':
      return createConvertedTransaction(event);
    case 'wallet.funds_locked':
      return createLockedTransaction(event);
    case 'wallet.funds_unlocked':
      return createUnlockedTransaction(event);
    case 'payment.request_fulfilled':
      return createPaymentFulfilledTransaction(event);
    default:
      // Fallback for unknown event types
      return [{
        id: event.id,
        title: 'Movimiento financiero',
        date: event.createdAt.toISOString(),
        amount: '0.00',
        isPositive: false,
        type: 'unknown',
        concept: `Evento desconocido: ${event.eventType}`,
        expiresAt: undefined,
        qrPayload: undefined,
        signature: undefined,
        section: undefined,
      }];
  }
}

/* ── Funciones específicas para cada tipo de evento ──────────────────────── */

function createDepositTransaction(event: {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}): TransactionItem[] {
  if (!isValidFinancialPayload(event.payload)) {
    return [{
      id: event.id,
      title: 'Depósito',
      date: event.createdAt.toISOString(),
      amount: '0.00',
      isPositive: true,
      type: 'unknown',
      concept: 'Payload de depósito inválido',
      expiresAt: undefined,
      qrPayload: undefined,
      signature: undefined,
      section: undefined,
    }];
  }

  const payload = event.payload as {
    amount: string;
    asset: { type: string; };
  };
  
  const amount = formatAmount(payload.amount, payload.asset.type);
  const assetName = getAssetName(payload.asset.type);
  // Try to extract signature from payload
  const signature = (payload as any).signature ?? (payload as any).transactionSignature;
  
  return [{
    id: event.id,
    title: `Depósito de ${assetName}`,
    date: event.createdAt.toISOString(),
    amount: `+ ${amount} ${assetName}`,
    isPositive: true,
    type: payload.asset.type.toLowerCase(),
    concept: `Se depositaron ${amount} ${assetName} en tu cuenta.`,
    expiresAt: undefined,
    qrPayload: undefined,
    signature,
    section: undefined, // Will be set in frontend based on date
  }];
}

function createWithdrawalTransaction(event: {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}): TransactionItem[] {
  if (!isValidFinancialPayload(event.payload)) {
    return [{
      id: event.id,
      title: 'Retiro',
      date: event.createdAt.toISOString(),
      amount: '0.00',
      isPositive: false,
      type: 'unknown',
      concept: 'Payload de retiro inválido',
      expiresAt: undefined,
      qrPayload: undefined,
      signature: undefined,
      section: undefined,
    }];
  }

  const payload = event.payload as {
    amount: string;
    asset: { type: string; };
  };
  
  const amount = formatAmount(payload.amount, payload.asset.type);
  const assetName = getAssetName(payload.asset.type);
  // Try to extract signature from payload
  const signature = (payload as any).signature ?? (payload as any).transactionSignature;
  
  return [{
    id: event.id,
    title: `Retiro de ${assetName}`,
    date: event.createdAt.toISOString(),
    amount: `- ${amount} ${assetName}`,
    isPositive: false,
    type: payload.asset.type.toLowerCase(),
    concept: `Se retiraron ${amount} ${assetName} de tu cuenta.`,
    expiresAt: undefined,
    qrPayload: undefined,
    signature,
    section: undefined, // Will be set in frontend based on date
  }];
}

function createSentTransaction(event: {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}): TransactionItem[] {
  if (!isValidFinancialPayload(event.payload)) {
    return [{
      id: event.id,
      title: 'Envío',
      date: event.createdAt.toISOString(),
      amount: '0.00',
      isPositive: false,
      type: 'unknown',
      concept: 'Payload de envío inválido',
      expiresAt: undefined,
      qrPayload: undefined,
      signature: undefined,
      section: undefined,
    }];
  }

  const payload = event.payload as {
    amount: string;
    asset: { type: string; };
  };
  
  const amount = formatAmount(payload.amount, payload.asset.type);
  const assetName = getAssetName(payload.asset.type);
  // Try to extract signature from payload
  const signature = (payload as any).signature ?? (payload as any).transactionSignature;
  
  return [{
    id: event.id,
    title: `Envío de ${assetName}`,
    date: event.createdAt.toISOString(),
    amount: `- ${amount} ${assetName}`,
    isPositive: false,
    type: payload.asset.type.toLowerCase(),
    concept: `Enviaste ${amount} ${assetName}.`,
    expiresAt: undefined,
    qrPayload: undefined,
    signature,
    section: undefined, // Will be set in frontend based on date
  }];
}

function createReceivedTransaction(event: {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}): TransactionItem[] {
  if (!isValidFinancialPayload(event.payload)) {
    return [{
      id: event.id,
      title: 'Recepción',
      date: event.createdAt.toISOString(),
      amount: '0.00',
      isPositive: true,
      type: 'unknown',
      concept: 'Payload de recepción inválido',
      expiresAt: undefined,
      qrPayload: undefined,
      signature: undefined,
      section: undefined,
    }];
  }

  const payload = event.payload as {
    amount: string;
    asset: { type: string; };
  };
  
  const amount = formatAmount(payload.amount, payload.asset.type);
  const assetName = getAssetName(payload.asset.type);
  // Try to extract signature from payload
  const signature = (payload as any).signature ?? (payload as any).transactionSignature;
  
  return [{
    id: event.id,
    title: `Recepción de ${assetName}`,
    date: event.createdAt.toISOString(),
    amount: `+ ${amount} ${assetName}`,
    isPositive: true,
    type: payload.asset.type.toLowerCase(),
    concept: `Recibiste ${amount} ${assetName}.`,
    expiresAt: undefined,
    qrPayload: undefined,
    signature,
    section: undefined, // Will be set in frontend based on date
  }];
}

function createSwapTransactions(event: {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}): TransactionItem[] {
  if (!isValidSwapPayload(event.payload)) {
    return [{
      id: event.id,
      title: 'Intercambio',
      date: event.createdAt.toISOString(),
      amount: '0.00',
      isPositive: false,
      type: 'unknown',
      concept: 'Payload de intercambio inválido',
      expiresAt: undefined,
      qrPayload: undefined,
      signature: undefined,
      section: undefined,
    }];
  }

  const payload = event.payload as {
    sourceAsset: { amount: string; type: string; };
    destinationAsset: { amount: string; type: string; };
  };
  
  const sourceAmount = formatAmount(payload.sourceAsset.amount, payload.sourceAsset.type);
  const sourceAssetName = getAssetName(payload.sourceAsset.type);
  const destAmount = formatAmount(payload.destinationAsset.amount, payload.destinationAsset.type);
  const destAssetName = getAssetName(payload.destinationAsset.type);
  // Try to extract signature from payload
  const signature = (payload as any).signature ?? (payload as any).transactionSignature;
  
  return [
    {
      id: `${event.id}-source`,
      title: `Intercambio: enviaste ${sourceAssetName}`,
      date: event.createdAt.toISOString(),
      amount: `- ${sourceAmount} ${sourceAssetName}`,
      isPositive: false,
      type: payload.sourceAsset.type.toLowerCase(),
      concept: `En el intercambio, enviaste ${sourceAmount} ${sourceAssetName} y recibiste ${destAmount} ${destAssetName}.`,
      expiresAt: undefined,
      qrPayload: undefined,
      signature,
      section: undefined, // Will be set in frontend based on date
    },
    {
      id: `${event.id}-destination`,
      title: `Intercambio: recibiste ${destAssetName}`,
      date: event.createdAt.toISOString(),
      amount: `+ ${destAmount} ${destAssetName}`,
      isPositive: true,
      type: payload.destinationAsset.type.toLowerCase(),
      concept: `En el intercambio, enviaste ${sourceAmount} ${sourceAssetName} y recibiste ${destAmount} ${destAssetName}.`,
      expiresAt: undefined,
      qrPayload: undefined,
      signature,
      section: undefined, // Will be set in frontend based on date
    }
  ];
}

function createBoughtTransaction(event: {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}): TransactionItem[] {
  if (!isValidTradePayload(event.payload)) {
    return [{
      id: event.id,
      title: 'Compra',
      date: event.createdAt.toISOString(),
      amount: '0.00',
      isPositive: false,
      type: 'unknown',
      concept: 'Payload de compra inválido',
      expiresAt: undefined,
      qrPayload: undefined,
      signature: undefined,
      section: undefined,
    }];
  }

  const payload = event.payload as {
    amount: string;
    asset: { type: string; };
  };
  
  const amount = formatAmount(payload.amount, payload.asset.type);
  const assetName = getAssetName(payload.asset.type);
  // Try to extract signature from payload
  const signature = (payload as any).signature ?? (payload as any).transactionSignature;
  
  return [{
    id: event.id,
    title: `Compra de ${assetName}`,
    date: event.createdAt.toISOString(),
    amount: `- ${amount} ${assetName}`, // You spent money to buy the asset
    isPositive: false,
    type: payload.asset.type.toLowerCase(),
    concept: `Compraste ${amount} ${assetName}.`,
    expiresAt: undefined,
    qrPayload: undefined,
    signature,
    section: undefined, // Will be set in frontend based on date
  }];
}

function createSoldTransaction(event: {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}): TransactionItem[] {
  if (!isValidTradePayload(event.payload)) {
    return [{
      id: event.id,
      title: 'Venta',
      date: event.createdAt.toISOString(),
      amount: '0.00',
      isPositive: true,
      type: 'unknown',
      concept: 'Payload de venta inválido',
      expiresAt: undefined,
      qrPayload: undefined,
      signature: undefined,
      section: undefined,
    }];
  }

  const payload = event.payload as {
    amount: string;
    asset: { type: string; };
  };
  
  const amount = formatAmount(payload.amount, payload.asset.type);
  const assetName = getAssetName(payload.asset.type);
  // Try to extract signature from payload
  const signature = (payload as any).signature ?? (payload as any).transactionSignature;
  
  return [{
    id: event.id,
    title: `Venta de ${assetName}`,
    date: event.createdAt.toISOString(),
    amount: `+ ${amount} ${assetName}`, // You received money from selling the asset
    isPositive: true,
    type: payload.asset.type.toLowerCase(),
    concept: `Vendiste ${amount} ${assetName}.`,
    expiresAt: undefined,
    qrPayload: undefined,
    signature,
    section: undefined, // Will be set in frontend based on date
  }];
}

function createYieldEarnedTransaction(event: {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}): TransactionItem[] {
  if (!isValidYieldPayload(event.payload)) {
    return [{
      id: event.id,
      title: 'Rendimiento ganado',
      date: event.createdAt.toISOString(),
      amount: '0.00',
      isPositive: true,
      type: 'unknown',
      concept: 'Payload de rendimiento inválido',
      expiresAt: undefined,
      qrPayload: undefined,
      signature: undefined,
      section: undefined,
    }];
  }

  const payload = event.payload as {
    amount: string;
    asset: { type: string; };
  };
  
  const amount = formatAmount(payload.amount, payload.asset.type);
  const assetName = getAssetName(payload.asset.type);
  // Try to extract signature from payload
  const signature = (payload as any).signature ?? (payload as any).transactionSignature;
  
  return [{
    id: event.id,
    title: `Rendimiento de ${assetName}`,
    date: event.createdAt.toISOString(),
    amount: `+ ${amount} ${assetName}`,
    isPositive: true,
    type: payload.asset.type.toLowerCase(),
    concept: `Ganaste ${amount} ${assetName} en rendimiento.`,
    expiresAt: undefined,
    qrPayload: undefined,
    signature,
    section: undefined, // Will be set in frontend based on date
  }];
}

function createYieldFeesPaidTransaction(event: {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}): TransactionItem[] {
  if (!isValidYieldPayload(event.payload)) {
    return [{
      id: event.id,
      title: 'Comisiones de rendimiento',
      date: event.createdAt.toISOString(),
      amount: '0.00',
      isPositive: false,
      type: 'unknown',
      concept: 'Payload de comisiones inválido',
      expiresAt: undefined,
      qrPayload: undefined,
      signature: undefined,
      section: undefined,
    }];
  }

  const payload = event.payload as {
    amount: string;
    asset: { type: string; };
  };
  
  const amount = formatAmount(payload.amount, payload.asset.type);
  const assetName = getAssetName(payload.asset.type);
  // Try to extract signature from payload
  const signature = (payload as any).signature ?? (payload as any).transactionSignature;
  
  return [{
    id: event.id,
    title: `Comisiones de ${assetName}`,
    date: event.createdAt.toISOString(),
    amount: `- ${amount} ${assetName}`,
    isPositive: false,
    type: payload.asset.type.toLowerCase(),
    concept: `Pagaste ${amount} ${assetName} en comisiones de rendimiento.`,
    expiresAt: undefined,
    qrPayload: undefined,
    signature,
    section: undefined, // Will be set in frontend based on date
  }];
}

function createConvertedTransaction(event: {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}): TransactionItem[] {
  if (!isValidFinancialPayload(event.payload)) {
    return [{
      id: event.id,
      title: 'Conversión',
      date: event.createdAt.toISOString(),
      amount: '0.00',
      isPositive: false,
      type: 'unknown',
      concept: 'Payload de conversión inválido',
      expiresAt: undefined,
      qrPayload: undefined,
      signature: undefined,
      section: undefined,
    }];
  }

  const payload = event.payload as {
    amount: string;
    asset: { type: string; };
  };
  
  const amount = formatAmount(payload.amount, payload.asset.type);
  const assetName = getAssetName(payload.asset.type);
  // Try to extract signature from payload
  const signature = (payload as any).signature ?? (payload as any).transactionSignature;
  
  return [{
    id: event.id,
    title: `Conversión de ${assetName}`,
    date: event.createdAt.toISOString(),
    amount: `+ ${amount} ${assetName}`, // Assuming conversion doesn't change net value, show as gained for consistency
    isPositive: true, // or false? Let's say gained for now
    type: payload.asset.type.toLowerCase(),
    concept: `Convertiste ${amount} ${assetName}.`,
    expiresAt: undefined,
    qrPayload: undefined,
    signature,
    section: undefined, // Will be set in frontend based on date
  }];
}

function createLockedTransaction(event: {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}): TransactionItem[] {
  if (!isValidFinancialPayload(event.payload)) {
    return [{
      id: event.id,
      title: 'Bloqueo de fondos',
      date: event.createdAt.toISOString(),
      amount: '0.00',
      isPositive: false,
      type: 'unknown',
      concept: 'Payload de bloqueo inválido',
      expiresAt: undefined,
      qrPayload: undefined,
      signature: undefined,
      section: undefined,
    }];
  }

  const payload = event.payload as {
    amount: string;
    asset: { type: string; };
  };
  
  const amount = formatAmount(payload.amount, payload.asset.type);
  const assetName = getAssetName(payload.asset.type);
  // Try to extract signature from payload
  const signature = (payload as any).signature ?? (payload as any).transactionSignature;
  
  return [{
    id: event.id,
    title: `Bloqueo de ${assetName}`,
    date: event.createdAt.toISOString(),
    amount: `- ${amount} ${assetName}`,
    isPositive: false,
    type: payload.asset.type.toLowerCase(),
    concept: `Bloqueaste ${amount} ${assetName}.`,
    expiresAt: undefined,
    qrPayload: undefined,
    signature,
    section: undefined, // Will be set in frontend based on date
  }];
}

function createUnlockedTransaction(event: {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}): TransactionItem[] {
  if (!isValidFinancialPayload(event.payload)) {
    return [{
      id: event.id,
      title: 'Desbloqueo de fondos',
      date: event.createdAt.toISOString(),
      amount: '0.00',
      isPositive: true,
      type: 'unknown',
      concept: 'Payload de desbloqueo inválido',
      expiresAt: undefined,
      qrPayload: undefined,
      signature: undefined,
      section: undefined,
    }];
  }

  const payload = event.payload as {
    amount: string;
    asset: { type: string; };
  };
  
  const amount = formatAmount(payload.amount, payload.asset.type);
  const assetName = getAssetName(payload.asset.type);
  // Try to extract signature from payload
  const signature = (payload as any).signature ?? (payload as any).transactionSignature;
  
  return [{
    id: event.id,
    title: `Desbloqueo de ${assetName}`,
    date: event.createdAt.toISOString(),
    amount: `+ ${amount} ${assetName}`,
    isPositive: true,
    type: payload.asset.type.toLowerCase(),
    concept: `Desbloqueaste ${amount} ${assetName}.`,
    expiresAt: undefined,
    qrPayload: undefined,
    signature,
    section: undefined, // Will be set in frontend based on date
  }];
}

function createPaymentFulfilledTransaction(event: {
  id: string;
  eventType: string;
  payload: unknown;
  createdAt: Date;
}): TransactionItem[] {
  if (!isValidPaymentPayload(event.payload)) {
    return [{
      id: event.id,
      title: 'Pago recibido',
      date: event.createdAt.toISOString(),
      amount: '0.00',
      isPositive: true,
      type: 'unknown',
      concept: 'Payload de pago inválido',
      expiresAt: undefined,
      qrPayload: undefined,
      signature: undefined,
      section: undefined,
    }];
  }

  const payload = event.payload as {
    amount: string;
  };
  
  const amount = formatAmount(payload.amount, 'usdc'); // Assuming USDC for payment requests
  // Try to extract signature from payload
  const signature = (payload as any).signature ?? (payload as any).transactionSignature;
  
  return [{
    id: event.id,
    title: `Pago de cobro`,
    date: event.createdAt.toISOString(),
    amount: `+ ${amount} USDC`,
    isPositive: true,
    type: 'usdc',
    concept: `Se pagó tu enlace de cobro por ${amount} USDC.`,
    expiresAt: undefined,
    qrPayload: undefined,
    signature,
    section: undefined, // Will be set in frontend based on date
  }];
}

/* ── Helper functions for validation and formatting ──────────────────────── */

function isValidFinancialPayload(payload: unknown): payload is { 
  amount: string; 
  asset: { type: string; } | null 
} {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'amount' in payload &&
    'asset' in payload &&
    typeof (payload as any).amount === 'string' &&
    (payload as any).asset !== null &&
    typeof (payload as any).asset?.type === 'string'
  );
}

function isValidSwapPayload(payload: unknown): payload is { 
  sourceAsset: { amount: string; type: string; };
  destinationAsset: { amount: string; type: string; };
  swapDetails?: { price: string; fee: string; } | null;
} {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'sourceAsset' in payload &&
    'destinationAsset' in payload &&
    typeof (payload as any).sourceAsset?.amount === 'string' &&
    typeof (payload as any).sourceAsset?.type === 'string' &&
    typeof (payload as any).destinationAsset?.amount === 'string' &&
    typeof (payload as any).destinationAsset?.type === 'string'
  );
}

function isValidTradePayload(payload: unknown): payload is { 
  amount: string; 
  asset: { type: string; } | null 
} {
  return isValidFinancialPayload(payload);
}

function isValidYieldPayload(payload: unknown): payload is { 
  amount: string; 
  asset: { type: string; } | null 
} {
  return isValidFinancialPayload(payload);
}

function isValidPaymentPayload(payload: unknown): payload is { 
  amount: string; 
} {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'amount' in payload &&
    typeof (payload as any).amount === 'string'
  );
}

/**
 * Formats an amount string with the correct number of decimals.
 *
 * Amounts in payloads are in base units (e.g., USDC has 6 decimals, so 1 USDC = 1000000).
 * This function converts to human-readable format with commas and correct decimal places.
 */
function formatAmount(amountStr: string, assetType: string | null | undefined): string {
  // Define decimals per asset type
  const DECIMALS: Record<string, number> = {
    'usdc': 6,
    'usdt': 6,
    'trx': 6,
    'doge': 8,
    'sol': 9,
    'ars': 2, // Argentine pesos
    'btc': 8,
    'eth': 18,
  };
  
  const decimals = DECIMALS[assetType ?? ''] ?? 6; // default to 6 if unknown
  
  try {
    const amountBigInt = BigInt(amountStr);
    if (amountBigInt < 0n) {
      // Handle negative amounts if needed
      return `-${formatAmount(amountStr.slice(1), assetType)}`;
    }
    
    // Convert to decimal string
    const amountStrPadded = amountStr.padStart(decimals + 1, '0');
    const integerPart = amountStrPadded.slice(0, -decimals) || '0';
    const fractionalPart = amountStrPadded.slice(-decimals).padStart(decimals, '0');
    
    // Remove trailing zeros from fractional part
    let trimmedFractional = fractionalPart.replace(/0+$/, '');
    if (trimmedFractional === '') trimmedFractional = '0';
    
    // Format integer part with thousands separators
    const formattedInteger = integerPart
      .replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
    
    return `${formattedInteger},${trimmedFractional}`;
  } catch (e) {
    // If parsing fails, return the raw amount as a fallback
    return amountStr;
  }
}

/**
 * Gets the display name for an asset type.
 */
function getAssetName(assetType: string | null | undefined): string {
  const NAMES: Record<string, string> = {
    'usdc': 'USDC',
    'usdt': 'USDT0',
    'trx': 'TRX',
    'doge': 'DOGE',
    'sol': 'SOL',
    'ars': 'ARS',
    'btc': 'BTC',
    'eth': 'ETH',
  };
  
  return NAMES[assetType ?? ''] ?? assetType ?? '??';
}
