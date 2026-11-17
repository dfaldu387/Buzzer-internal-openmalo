/**
 * Unit tests for the pure-JS SHA-256 PIN hashing module.
 * No mocks needed — crypto.ts is pure business logic.
 */

import {hashPin, verifyPin} from '../src/services/crypto';

describe('crypto — hashPin', () => {
  it('returns a v2-prefixed hash', () => {
    const hash = hashPin('1234');
    expect(hash).toMatch(/^v2:[a-z0-9]{16}:[a-f0-9]{64}$/);
  });

  it('produces different hashes for the same PIN (random salt)', () => {
    const h1 = hashPin('1234');
    const h2 = hashPin('1234');
    expect(h1).not.toBe(h2); // different salts
  });

  it('produces different hashes for different PINs', () => {
    const h1 = hashPin('1234');
    const h2 = hashPin('5678');
    // Salts differ too, but the hashes themselves should differ
    const hash1 = h1.split(':')[2];
    const hash2 = h2.split(':')[2];
    expect(hash1).not.toBe(hash2);
  });

  it('handles empty PIN without crashing', () => {
    const hash = hashPin('');
    expect(hash).toMatch(/^v2:/);
  });

  it('handles unicode PIN', () => {
    const hash = hashPin('🔑1234');
    expect(hash).toMatch(/^v2:[a-z0-9]{16}:[a-f0-9]{64}$/);
  });

  it('handles very long PIN', () => {
    const hash = hashPin('1'.repeat(1000));
    expect(hash).toMatch(/^v2:/);
  });
});

describe('crypto — verifyPin', () => {
  it('verifies a correct PIN against its own hash', () => {
    const hash = hashPin('9999');
    expect(verifyPin('9999', hash)).toBe(true);
  });

  it('rejects an incorrect PIN', () => {
    const hash = hashPin('1234');
    expect(verifyPin('0000', hash)).toBe(false);
  });

  it('rejects a malformed v2 hash (wrong number of parts)', () => {
    expect(verifyPin('1234', 'v2:saltonly')).toBe(false);
  });

  it('rejects a v2 hash with tampered hash portion', () => {
    const hash = hashPin('1234');
    const tampered = hash.slice(0, -1) + (hash.endsWith('0') ? '1' : '0');
    expect(verifyPin('1234', tampered)).toBe(false);
  });

  it('verifies legacy DJB2 format for migration', () => {
    // Legacy hash of '1234': buzzer_1234_salt → DJB2
    const legacyHash = (() => {
      let h = 0;
      const str = 'buzzer_1234_salt';
      for (let i = 0; i < str.length; i++) {
        h = (h << 5) - h + str.charCodeAt(i);
        h |= 0;
      }
      return h.toString(36);
    })();
    expect(verifyPin('1234', legacyHash)).toBe(true);
    expect(verifyPin('0000', legacyHash)).toBe(false);
  });

  it('handles empty stored hash', () => {
    expect(verifyPin('1234', '')).toBe(false);
  });
});
