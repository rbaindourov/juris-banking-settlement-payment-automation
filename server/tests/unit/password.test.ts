import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { User } from '../../src/models/User';

describe('Password Hashing & Verification (bcryptjs)', () => {
  it('hashes plain text password and validates correct password match', async () => {
    const rawPassword = 'SuperSecretPassword123!';
    const hash = await User.hashPassword(rawPassword);

    expect(hash).toBeDefined();
    expect(typeof hash).toBe('string');
    expect(hash).not.toBe(rawPassword);
    expect(hash.startsWith('$2')).toBe(true);

    const isMatch = await bcrypt.compare(rawPassword, hash);
    expect(isMatch).toBe(true);
  });

  it('rejects incorrect password against generated hash', async () => {
    const rawPassword = 'CorrectPassword999';
    const wrongPassword = 'WrongPassword000';
    const hash = await User.hashPassword(rawPassword);

    const isMatch = await bcrypt.compare(wrongPassword, hash);
    expect(isMatch).toBe(false);
  });

  it('produces unique hashes for the same password due to random salting', async () => {
    const password = 'IdenticalPasswordToHash';
    const hash1 = await User.hashPassword(password);
    const hash2 = await User.hashPassword(password);

    expect(hash1).not.toBe(hash2);
    expect(await bcrypt.compare(password, hash1)).toBe(true);
    expect(await bcrypt.compare(password, hash2)).toBe(true);
  });
});
