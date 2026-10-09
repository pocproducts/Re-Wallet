/**
 * `event_type` → sentence, and which payload shape belongs to a person.
 *
 * The fallback is the interesting half: an event type nobody anticipated must
 * still render as something a person can read, and must not claim to know what
 * happened.
 */
import { describe, expect, it } from 'vitest';

import { describeEvent, UNKNOWN_EVENT_MESSAGE } from '../../src/domain/webhooks/eventDescription';
import {
  containmentShape,
  extractPersonDid,
  PERSON_DID_PATHS,
  PERSON_WALLET_ID_PATHS,
  personDidContainments,
  personWalletIdContainments,
} from '../../src/domain/webhooks/attribution';

const DID = 'did:privy:2test0000000000000000000000000000000';
/** Another person. Nothing of theirs may ever reach this person's feed. */
const OTHER_DID = 'did:privy:2other00000000000000000000000000000';

/** `document @> shape` for the documents these events carry. */
const jsonbContains = (document: unknown, shape: unknown): boolean => {
  if (typeof shape !== 'object' || shape === null || Array.isArray(shape)) return document === shape;
  if (typeof document !== 'object' || document === null || Array.isArray(document)) return false;
  return Object.entries(shape as Record<string, unknown>).every(
    ([key, value]) => key in (document as Record<string, unknown>) &&
      jsonbContains((document as Record<string, unknown>)[key], value),
  );
};

describe('describeEvent — the types this product knows', () => {
  const cases: readonly [string, string][] = [
    ['user.created', 'account'],
    ['user.updated', 'account'],
    ['user.deleted', 'account'],
    ['user.signed_in', 'security'],
    ['user.auth_recovered', 'security'],
    ['wallet.created', 'wallet'],
    ['wallet.deleted', 'wallet'],
    ['linked_account.created', 'link'],
    ['linked_account.deleted', 'link'],
  ];

  for (const [eventType, category] of cases) {
    it(`gives ${eventType} a ${category} sentence`, () => {
      const described = describeEvent(eventType);

      expect(described.category).toBe(category);
      expect(described.message.trim().length).toBeGreaterThan(0);
      expect(described.message).not.toContain(eventType);
      // A sentence, not a log line.
      expect(described.message.endsWith('.')).toBe(true);
    });
  }

  it('does not repeat itself for two types of the same category', () => {
    const messages = cases.map(([eventType]) => describeEvent(eventType).message);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it('leaves the nine account sentences byte-identical, payload or not', () => {
    // The whole change is about money events. These nine are pinned exactly,
    // and stay that way whatever payload the row happens to carry.
    const expected: Record<string, string> = {
      'user.created': 'Se creó tu cuenta en ReWALLET.',
      'user.updated': 'Se actualizaron los datos de tu cuenta.',
      'user.deleted': 'Se eliminó tu cuenta.',
      'user.signed_in': 'Iniciaste sesión en ReWALLET.',
      'user.auth_recovered': 'Recuperaste el acceso a tu cuenta.',
      'wallet.created': 'Se creó una billetera nueva en tu cuenta.',
      'wallet.deleted': 'Se eliminó una billetera de tu cuenta.',
      'linked_account.created': 'Conectaste un método de acceso a tu cuenta.',
      'linked_account.deleted': 'Desconectaste un método de acceso de tu cuenta.',
    };

    for (const [eventType, message] of Object.entries(expected)) {
      expect(describeEvent(eventType).message).toBe(message);
      expect(describeEvent(eventType, { caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', amount: '6006650' }).message).toBe(message);
    }
  });
});

describe('describeEvent — the money events, which carry no DID', () => {
  const money: readonly [string, string][] = [
    ['wallet.funds_deposited', 'Llegaron fondos a tu billetera.'],
    ['wallet.funds_withdrawn', 'Salieron fondos de tu billetera.'],
    ['transaction.broadcasted', 'Se envió una transacción desde tu billetera.'],
    ['transaction.confirmed', 'Se confirmó una transacción de tu billetera.'],
    ['transaction.execution_reverted', 'Una transacción de tu billetera se revirtió.'],
    ['transaction.failed', 'Una transacción de tu billetera falló.'],
    ['transaction.still_pending', 'Una transacción de tu billetera sigue pendiente.'],
    ['transaction.replaced', 'Una transacción de tu billetera fue reemplazada.'],
  ];

  for (const [eventType, message] of money) {
    it(`gives ${eventType} a wallet sentence that says what happened`, () => {
      const described = describeEvent(eventType);

      expect(described).toEqual({ message, category: 'wallet' });
      // Second person, and the word for the wallet, not a log line about a type.
      expect(described.message).toContain('tu ');
      expect(described.message).not.toContain(eventType);
    });

    it(`invents nothing ${eventType} did not carry`, () => {
      const { message } = describeEvent(eventType);

      // No amount, no asset, no chain: this table only ever receives the type.
      expect(message).not.toMatch(/\d/);
      expect(message).not.toMatch(/mon|eth|usdc|usd|eip155|matic|\$/i);
    });
  }

  it('never repeats a sentence across the money events', () => {
    const messages = money.map(([eventType]) => describeEvent(eventType).message);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it('says nothing about Wallet Actions, which cannot fire in this product', () => {
    // We sign in the browser and move money ourselves; Privy never performs the
    // transfer, so a sentence for these would describe a flow we do not have.
    for (const eventType of [
      'wallet_action.transfer.created',
      'wallet_action.transfer.completed',
      'wallet_action.transfer.failed',
    ]) {
      const described = describeEvent(eventType);
      expect(described.message).toBe(UNKNOWN_EVENT_MESSAGE);
      expect(described.category).toBe('other');
    }
  });
});

describe('describeEvent — the amount a deposit may state', () => {
  const NATIVE = { type: 'native-token', address: null };
  const SENDER = '8o9sri4iYYvUKds7Lu3ENa4c7RDswwrrzNugjFkqwjxy';
  const RECIPIENT = '2FYhafYQKkrEMMgF1w5Y517xbd9iD2zX1KbXMvuG76RF';
  const WALLET_ID = 'x2tmz6fpz57yv1q5bciddxzc';

  /** The real `wallet.funds_deposited` that arrived and could not be understood. */
  const SOLANA_DEPOSIT = {
    type: 'wallet.funds_deposited',
    wallet_id: WALLET_ID,
    caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    asset: NATIVE,
    amount: '6006650',
    sender: SENDER,
    recipient: RECIPIENT,
    transaction_hash: '4BsbV8gu',
    block: { number: 453667852 },
  } as const;

  const GENERIC_DEPOSIT = 'Llegaron fondos a tu billetera.';

  it('states the figure, with the decimals our catalog declares — not the payload\'s', () => {
    // `6006650` says nothing about its unit. SOL is 9 decimals **because our
    // catalog says so**; the payload contributes the digits and nothing else.
    // Exact digits, not a substring: the on-chain balance is this figure.
    expect(describeEvent('wallet.funds_deposited', SOLANA_DEPOSIT)).toEqual({
      message: 'Entraron 0.00600665 SOL.',
      category: 'wallet',
    });
  });

  it('uses 18 decimals for Monad native, which would be a different figure entirely', () => {
    const monad = { ...SOLANA_DEPOSIT, caip2: 'eip155:143', amount: '1500000000000000000' };

    // Read as 9 decimals the same payload would read as 1.5 billion MON.
    expect(describeEvent('wallet.funds_deposited', monad).message).toBe('Entraron 1.5 MON.');

    const ethereum = { ...SOLANA_DEPOSIT, caip2: 'eip155:1', amount: '1' };
    expect(describeEvent('wallet.funds_deposited', ethereum).message).toBe('Entraron 0.000000000000000001 ETH.');
  });

  it('uses 6 decimals for USDC, and matches it on the contract of that chain', () => {
    // Same six decimals in three chains, three different contracts: matching the
    // address is what keeps a Solana mint from being read as a Monad token.
    const monadUsdc = {
      ...SOLANA_DEPOSIT,
      caip2: 'eip155:143',
      asset: { type: 'token', address: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' },
      amount: '1234567',
    };
    const solanaUsdc = {
      ...SOLANA_DEPOSIT,
      asset: { type: 'token', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
      amount: '1500000',
    };

    expect(describeEvent('wallet.funds_deposited', monadUsdc).message).toBe('Entraron 1.234567 USDC.');
    expect(describeEvent('wallet.funds_deposited', solanaUsdc).message).toBe('Entraron 1.5 USDC.');
  });

  it('says nothing about the amount when the chain is one we do not carry', () => {
    const unknown = { ...SOLANA_DEPOSIT, caip2: 'eip155:56', amount: '6006650' };

    const { message } = describeEvent('wallet.funds_deposited', unknown);

    expect(message).toBe(GENERIC_DEPOSIT);
    expect(message).not.toMatch(/\d/);
    expect(message).not.toMatch(/sol|eth|mon|usd|eip155|\$/i);
  });

  it('says nothing about the amount when the payload does not carry one', () => {
    for (const payload of [
      { ...SOLANA_DEPOSIT, amount: undefined },
      { ...SOLANA_DEPOSIT, amount: null },
      { ...SOLANA_DEPOSIT, amount: 'not a number' },
      // A `transaction.*` payload shape, which has no amount at all.
      { type: 'transaction.confirmed', caip2: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', asset: NATIVE },
    ]) {
      const { message } = describeEvent('wallet.funds_deposited', payload);

      expect(message).toBe(GENERIC_DEPOSIT);
      expect(message).not.toMatch(/\d/);
    }
  });

  it('leaves a transaction sentence exactly as it was, payload or not', () => {
    // `transaction.*` carries no amount. There is nothing to state, so the
    // sentence must not move — not even if a payload with an amount is handed in.
    const withAmount = { ...SOLANA_DEPOSIT, type: 'transaction.confirmed' };

    for (const eventType of [
      'transaction.confirmed',
      'transaction.broadcasted',
      'transaction.failed',
      'transaction.replaced',
      'transaction.still_pending',
      'transaction.execution_reverted',
    ]) {
      expect(describeEvent(eventType, withAmount)).toEqual(describeEvent(eventType));
      expect(describeEvent(eventType, withAmount).message).not.toMatch(/\d/);
    }
  });

  it('never carries an address, a wallet id or a hash into a sentence', () => {
    // Structural, not a sample: the sentence is the only thing the screen gets,
    // and `docs/contrato-dinero.md` forbids a person seeing an address.
    const produced = [
      describeEvent('wallet.funds_deposited', SOLANA_DEPOSIT).message,
      describeEvent('wallet.funds_deposited', { ...SOLANA_DEPOSIT, caip2: 'eip155:143', amount: '1' }).message,
      describeEvent('wallet.funds_withdrawn', SOLANA_DEPOSIT).message,
    ];

    for (const message of produced) {
      expect(message).not.toContain(SENDER);
      expect(message).not.toContain(RECIPIENT);
      expect(message).not.toContain(WALLET_ID);
      // Not truncated either: an ellipsised address is still an address.
      for (const address of [SENDER, RECIPIENT]) {
        for (let start = 0; start < address.length; start += 8) {
          expect(message).not.toContain(address.slice(start, start + 8));
        }
      }
      // And nothing that looks like one at all.
      expect(message).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{32,}|0x[0-9a-fA-F]{8,}/);
    }
  });

  it('reads three fields and no others, so a payload cannot speak through it', () => {
    // An amount is the whole of what this module is allowed to know.
    const described = describeEvent('wallet.funds_deposited', SOLANA_DEPOSIT);

    expect(Object.keys(described).sort()).toEqual(['category', 'message']);
    // No symbol or value is smuggled out beside the sentence.
    expect(JSON.stringify(described)).not.toContain('6006650');
  });
});

describe('PERSON_WALLET_ID_PATHS — where a money event names its wallet', () => {
  it('covers the flat shape and the one nested under data', () => {
    expect(PERSON_WALLET_ID_PATHS).toContain('wallet_id');
    expect(PERSON_WALLET_ID_PATHS).toContain('data.wallet_id');
  });

  it('builds one containment per path, and each shape finds its own event', () => {
    const shapes = personWalletIdContainments('fmfdjm1ne');

    expect(shapes).toContainEqual({ wallet_id: 'fmfdjm1ne' });
    expect(shapes).toContainEqual({ data: { wallet_id: 'fmfdjm1ne' } });

    // The two real Privy shapes, as `payload @> shape` would find them.
    const deposit = { type: 'wallet.funds_deposited', wallet_id: 'fmfdjm1ne', caip2: 'eip155:143', amount: '4' };
    const broadcast = { type: 'transaction.broadcasted', data: { wallet_id: 'fmfdjm1ne', transaction_id: 'tx_1' } };

    expect(jsonbContains(deposit, shapes[0])).toBe(true);
    expect(jsonbContains(broadcast, shapes[1])).toBe(true);
    // Each shape finds its own shape only.
    expect(jsonbContains(broadcast, shapes[0])).toBe(false);
    expect(jsonbContains(deposit, shapes[1])).toBe(false);
  });

  it('does not read a wallet id out of a field that only mentions one', () => {
    // `sender` and `recipient` are the addresses money came from and went to. An
    // event is about the wallet it names, not about wallets it mentions.
    const shapes = JSON.stringify(personWalletIdContainments('fmfdjm1ne'));

    expect(shapes).not.toContain('sender');
    expect(shapes).not.toContain('recipient');
  });

  it('uses the same path builder as the DID shapes', () => {
    expect(containmentShape('user.id', DID)).toEqual({ user: { id: DID } });
    expect(containmentShape('wallet_id', 'w1')).toEqual({ wallet_id: 'w1' });
    // A single key is not nested, and a missing value is not a wildcard.
    expect(containmentShape('data.wallet_id', 'w1')).toEqual({ data: { wallet_id: 'w1' } });
  });
});

describe('describeEvent — a type nobody anticipated', () => {
  it('says an event happened, without inventing what it was', () => {
    const described = describeEvent('wallet.brand_new_event_type');

    expect(described.message).toBe(UNKNOWN_EVENT_MESSAGE);
    expect(described.category).toBe('other');
    // It does not guess a chain, an amount or an outcome.
    expect(described.message).not.toMatch(/monad|ethereum|solana|usd|\$/i);
  });

  it('never renders blank, for any input at all', () => {
    for (const eventType of ['', '   ', 'user.created ', 'USER.CREATED', '<script>', 'a'.repeat(500)]) {
      const described = describeEvent(eventType);
      expect(described.message.trim().length).toBeGreaterThan(0);
      expect(described.category.length).toBeGreaterThan(0);
    }
  });

  it('is case sensitive on purpose: an unrecognised shape falls back rather than guessing', () => {
    expect(describeEvent('user.created').category).toBe('account');
    expect(describeEvent('User.Created').message).toBe(UNKNOWN_EVENT_MESSAGE);
  });
});

describe('extractPersonDid', () => {
  it('reads the DID from the shapes Privy sends', () => {
    expect(extractPersonDid({ type: 'user.created', user_did: DID })).toBe(DID);
    expect(extractPersonDid({ type: 'user.created', user: { id: DID, email: 'ana@example.com' } })).toBe(DID);
    expect(extractPersonDid({ object: 'event', user_did: DID })).toBe(DID);
    expect(extractPersonDid({ object: 'event', user: { id: DID } })).toBe(DID);
    expect(extractPersonDid({ type: 'wallet.created', wallet: { user_did: DID, address: '0xabc' } })).toBe(DID);
  });

  it('reports no person for an app-level event, and does not guess', () => {
    expect(extractPersonDid({ type: 'app.updated', data: { region: 'sa-east-1' } })).toBeNull();
    expect(extractPersonDid({})).toBeNull();
    expect(extractPersonDid(null)).toBeNull();
    expect(extractPersonDid('a string')).toBeNull();
  });

  it('ignores a DID-shaped string that is not in one of those paths', () => {
    // The event *mentions* somebody else. Mentioning is not belonging.
    expect(extractPersonDid({ type: 'wallet.created', invited_by: DID })).toBeNull();
    expect(extractPersonDid({ type: 'wallet.created', user: { email: 'ana@example.com', invited_by: DID } })).toBeNull();
  });

  it('ignores a value in a known path that is not a DID', () => {
    expect(extractPersonDid({ user_did: 'someone@example.com' })).toBeNull();
    expect(extractPersonDid({ user_did: '' })).toBeNull();
    expect(extractPersonDid({ user_did: 42 })).toBeNull();
    expect(extractPersonDid({ user: 'did:privy:2test' })).toBeNull();
  });
});

describe('extractPersonDid — `user_id`, the path production actually sends', () => {
  it('reads the two event shapes that are really on file', () => {
    // Verbatim top-level keys of the rows in rewallet.webhook_events. With `user_id`
    // missing from the list, both of these read as "no person" — silently.
    expect(extractPersonDid({ type: 'wallet.created', user_id: DID, wallet_id: 'rer86yvy1toc52vbhqqle7rr' })).toBe(DID);
    expect(extractPersonDid({ type: 'user.signed_in', user_id: DID })).toBe(DID);
  });

  it('reads the nested shape too, without reading it from anywhere else', () => {
    expect(extractPersonDid({ type: 'user.updated', data: { user_id: DID } })).toBe(DID);
    // Still a claim about a known path: `invited_by` is nobody's feed entry.
    expect(extractPersonDid({ type: 'wallet.created', invited_by: DID })).toBeNull();
  });

  it('keeps `user_did`, which Privy documents and other payload shapes use', () => {
    // Both names are true of different events; dropping either hides real events.
    expect(PERSON_DID_PATHS).toContain('user_did');
    expect(PERSON_DID_PATHS).toContain('user_id');
    expect(extractPersonDid({ type: 'user.created', user_did: DID })).toBe(DID);
    expect(extractPersonDid({ type: 'user.created', user_id: DID })).toBe(DID);
  });

  it('does not let one person\'s id be read out of the other\'s path', () => {
    // `user_did` and `user_id` are separate paths, not synonyms to be merged.
    const shapes = personDidContainments(DID);
    expect(shapes).toContainEqual({ user_did: DID });
    expect(shapes).toContainEqual({ user_id: DID });
    expect(shapes.some((shape) => jsonbContains({ user_did: OTHER_DID }, shape))).toBe(false);
    expect(shapes.some((shape) => jsonbContains({ user_id: OTHER_DID }, shape))).toBe(false);
  });

  it('rejects a `user_id` that is not a DID', () => {
    // Privy sends strings; only a `did:privy:…` one is a person.
    expect(extractPersonDid({ type: 'user.signed_in', user_id: 'someone@example.com' })).toBeNull();
    expect(extractPersonDid({ type: 'user.signed_in', user_id: '' })).toBeNull();
    expect(extractPersonDid({ type: 'user.signed_in', user_id: 42 })).toBeNull();
  });
});

describe('personDidContainments', () => {
  it('builds one jsonb shape per path, and every shape matches its own path', () => {
    const shapes = personDidContainments(DID);

    expect(shapes.length).toBe(PERSON_DID_PATHS.length);
    expect(shapes).toContainEqual({ user_did: DID });
    expect(shapes).toContainEqual({ user_id: DID });
    expect(shapes).toContainEqual({ data: { user_id: DID } });
    expect(shapes).toContainEqual({ user: { id: DID } });
    expect(shapes).toContainEqual({ object: { user: { id: DID } } });

    for (const shape of shapes) {
      expect(JSON.stringify(shape)).toContain(DID);
    }
  });

  it('covers exactly the paths the extraction reads', () => {
    // One definition of the shape, used for writing and for reading.
    const shapes = personDidContainments(DID);
    const covered = shapes.filter((shape) => {
      const holder = { ...(shape as Record<string, unknown>) };
      return JSON.stringify(holder).includes(DID);
    });

    expect(covered).toHaveLength(shapes.length);
  });
});
