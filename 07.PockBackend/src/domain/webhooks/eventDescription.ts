/**
 * Describable webhook events: turns an event type and payload into a human-
 * readable sentence and a category for UI treatment.
 *
 * This file contains two describing functions:
 *   - describeEvent: for general system notifications (login, wallet creation, etc.)
 *   - describeFinancialEvent: for money movements (deposits, sends, swaps, etc.)
 *
 * ── Why two functions ────────────────────────────────────────────────────────
 *
 * Notification messages and transaction messages serve different purposes and
 * should be formatted differently, even if they come from the same event source.
 *
 *   - Notifications: inform the user about account activity ("Se creó una billetera")
 *   - Transactions: show financial movements with amounts ("Entraron 1.00 USDC")
 *
 * Keeping them separate prevents mixing concerns and allows each to evolve
 * independently.
 */
import type { NotificationCategory } from './eventDescription';

/** Categories that the UI knows how to paint. */
export const KNOWN_CATEGORIES: readonly NotificationCategory[] = [
  'account',
  'security',
  'wallet',
  'link',
  'other',
] as const;

/** Is it a category the UI knows how to paint? */
const isKnownCategory = (value: unknown): value is NotificationCategory =>
  typeof value === 'string' && (KNOWN_CATEGORIES as readonly string[]).includes(value);

/**
 * Describes a general system event for notifications.
 *
 * This is the original function used by the notifications feed.
 */
export function describeEvent(
  eventType: string,
  payload: unknown
): { readonly category: NotificationCategory; readonly message: string } {
  // Map of known event types to their description and category
  const DESCRIBERS: Record<
    string,
    {
      readonly category: NotificationCategory;
      readonly message: (payload: unknown) => string;
    }
  > = {
    'user.created': {
      category: 'account',
      message: () => 'Se creó tu cuenta en ReWALLET.',
    },
    'wallet.created': {
      category: 'wallet',
      message: () => 'Se creó una billetera nueva en tu cuenta.',
    },
    'user.email_verified': {
      category: 'security',
      message: () => 'Verificaste tu dirección de correo electrónico.',
    },
    'user.phone_verified': {
      category: 'security',
      message: () => 'Verificaste tu número de teléfono.',
    },
    'user.password_updated': {
      category: 'security',
      message: () => 'Actualizaste tu contraseña.',
    },
    'session.created': {
      category: 'security',
      message: () => 'Iniciaste sesión en un nuevo dispositivo.',
    },
    'session.removed': {
      category: 'security',
      message: () => 'Cerraste sesión en un dispositivo.',
    },
    'link.created': {
      category: 'link',
      message: () => 'Creaste un nuevo enlace de cobro.',
    },
    'link.used': {
      category: 'link',
      message: (p) => {
        const amount = typeof p === 'object' && p !== null && 'amount' in p
          ? String(p.amount)
          : '??';
        return `Alguien pagó tu enlace de cobro por ${amount} USDC.`;
      },
    },
    'link.expired': {
      category: 'link',
      message: () => 'Tu enlace de cobro expiró sin ser usado.',
    },
  };

  const describer = DESCRIBERS[eventType];
  if (describer) {
    return {
      category: describer.category,
      message: describer.message(payload),
    };
  }

  // Fallback for unknown event types: show a generic message with the event type
  // but never invent details that aren't in the payload.
  return {
    category: 'other',
    message: `Ocurrió un evento: ${eventType}`,
  };
}

/**
 * Describes a financial event for the transaction feed.
 *
 * This function is used by the transactions endpoint to convert webhook events
 * into transaction items with amounts and clear income/expense language.
 */
export function describeFinancialEvent(
  eventType: string,
  payload: unknown
): { readonly category: NotificationCategory; readonly message: string } {
  // Map of known financial event types to their description and category
  const FINANCIAL_DESCRIBERS: Record<
    string,
    {
      readonly category: NotificationCategory;
      readonly message: (payload: unknown) => string;
    }
  > = {
    // Deposits/withdrawals
    'wallet.funds_deposited': {
      category: 'wallet',
      message: (p) => {
        if (!isValidFinancialPayload(p)) return 'Entraron fondos.';
        const amount = formatAmount((p as any).amount, (p as any).asset?.type);
        const assetName = getAssetName((p as any).asset?.type);
        return `Entraron ${amount} ${assetName}.`;
      },
    },
    'wallet.funds_withdrawn': {
      category: 'wallet',
      message: (p) => {
        if (!isValidFinancialPayload(p)) return 'Salieron fondos.';
        const amount = formatAmount((p as any).amount, (p as any).asset?.type);
        const assetName = getAssetName((p as any).asset?.type);
        return `Salieron ${amount} ${assetName}.`;
      },
    },
    
    // Sends/receives
    'wallet.funds_sent': {
      category: 'wallet',
      message: (p) => {
        if (!isValidFinancialPayload(p)) return 'Enviaste fondos.';
        const amount = formatAmount((p as any).amount, (p as any).asset?.type);
        const assetName = getAssetName((p as any).asset?.type);
        return `Enviaste ${amount} ${assetName}.`;
      },
    },
    'wallet.funds_received': {
      category: 'wallet',
      message: (p) => {
        if (!isValidFinancialPayload(p)) return 'Recibiste fondos.';
        const amount = formatAmount((p as any).amount, (p as any).asset?.type);
        const assetName = getAssetName((p as any).asset?.type);
        return `Recibiste ${amount} ${assetName}.`;
      },
    },
    
    // Swaps/trades
    'wallet.asset_swapped': {
      category: 'wallet',
      message: (p) => {
        if (!isValidSwapPayload(p)) return 'Cambiaste activos.';
        const sourceAmount = formatAmount((p as any).sourceAsset?.amount, (p as any).sourceAsset?.type);
        const sourceAsset = getAssetName((p as any).sourceAsset?.type);
        const destAmount = formatAmount((p as any).destinationAsset?.amount, (p as any).destinationAsset?.type);
        const destAsset = getAssetName((p as any).destinationAsset?.type);
        return `Cambiaste ${sourceAmount} ${sourceAsset} por ${destAmount} ${destAsset}.`;
      },
    },
    'wallet.asset_bought': {
      category: 'wallet',
      message: (p) => {
        if (!isValidTradePayload(p)) return 'Compraste un activo.';
        const amount = formatAmount((p as any).amount, (p as any).asset?.type);
        const assetName = getAssetName((p as any).asset?.type);
        return `Compraste ${amount} ${assetName}.`;
      },
    },
    'wallet.asset_sold': {
      category: 'wallet',
      message: (p) => {
        if (!isValidTradePayload(p)) return 'Vendiste un activo.';
        const amount = formatAmount((p as any).amount, (p as any).asset?.type);
        const assetName = getAssetName((p as any).asset?.type);
        return `Vendiste ${amount} ${assetName}.`;
      },
    },
    
    // Yield/earnings
    'wallet.yield_earned': {
      category: 'wallet',
      message: (p) => {
        if (!isValidYieldPayload(p)) return 'Ganaste rendimiento.';
        const amount = formatAmount((p as any).amount, (p as any).asset?.type);
        const assetName = getAssetName((p as any).asset?.type);
        return `Ganaste ${amount} ${assetName} en rendimiento.`;
      },
    },
    'wallet.yield_fees_paid': {
      category: 'wallet',
      message: (p) => {
        if (!isValidYieldPayload(p)) return 'Pagaste comisiones de rendimiento.';
        const amount = formatAmount((p as any).amount, (p as any).asset?.type);
        const assetName = getAssetName((p as any).asset?.type);
        return `Pagaste ${amount} ${assetName} en comisiones.`;
      },
    },
    
    // Other platform movements
    'wallet.funds_converted': {
      category: 'wallet',
      message: (p) => {
        if (!isValidFinancialPayload(p)) return 'Convertiste fondos.';
        const amount = formatAmount((p as any).amount, (p as any).asset?.type);
        const assetName = getAssetName((p as any).asset?.type);
        return `Convertiste ${amount} ${assetName}.`;
      },
    },
    'wallet.funds_locked': {
      category: 'wallet',
      message: (p) => {
        if (!isValidFinancialPayload(p)) return 'Bloqueaste fondos.';
        const amount = formatAmount((p as any).amount, (p as any).asset?.type);
        const assetName = getAssetName((p as any).asset?.type);
        return `Bloqueaste ${amount} ${assetName}.`;
      },
    },
    'wallet.funds_unlocked': {
      category: 'wallet',
      message: (p) => {
        if (!isValidFinancialPayload(p)) return 'Desbloqueaste fondos.';
        const amount = formatAmount((p as any).amount, (p as any).asset?.type);
        const assetName = getAssetName((p as any).asset?.type);
        return `Desbloqueaste ${amount} ${assetName}.`;
      },
    },
    
    // Charge/payment requests
    'payment.request_created': {
      category: 'link',
      message: () => 'Creaste un nuevo enlace de cobro.',
    },
    'payment.request_fulfilled': {
      category: 'link',
      message: (p) => {
        if (!isValidPaymentPayload(p)) return 'Se pagó tu enlace de cobro.';
        const amount = formatAmount((p as any).amount, 'usdc');
        return `Se pagó tu enlace de cobro por ${amount} USDC.`;
      },
    },
    'payment.request_expired': {
      category: 'link',
      message: () => 'Tu enlace de cobro expiró sin ser usado.',
    },
  };

  const describer = FINANCIAL_DESCRIBERS[eventType];
  if (describer) {
    return {
      category: describer.category,
      message: describer.message(payload),
    };
  }

  // Fallback for unknown financial event types: show a generic message
  // but never invent details that aren't in the payload.
  return {
    category: 'wallet', // default to wallet for financial events
    message: `Ocurrió un movimiento financiero: ${eventType}`,
  };
}

/* ── Helper functions for formatting ──────────────────────────────────────── */

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