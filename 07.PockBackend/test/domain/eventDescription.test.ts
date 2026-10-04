/**
 * `event_type` → sentence, and which payload shape belongs to a person.
 *
 * The fallback is the interesting half: an event type nobody anticipated must
 * still render as something a person can read, and must not claim to know what
 * happened.
 */
import { describe, expect, it } from 'vitest';

import { describeEvent, UNKNOWN_EVENT_MESSAGE } from '../../src/domain/webhooks/eventDescription';
import { extractPersonDid, personDidContainments } from '../../src/domain/webhooks/attribution';

const DID = 'did:privy:2test0000000000000000000000000000000';

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

describe('personDidContainments', () => {
  it('builds one jsonb shape per path, and every shape matches its own path', () => {
    const shapes = personDidContainments(DID);

    expect(shapes.length).toBeGreaterThan(0);
    expect(shapes).toContainEqual({ user_did: DID });
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
