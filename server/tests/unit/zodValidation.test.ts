import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema } from '../../src/controllers/auth.controller';

describe('Zod Auth Validation Schemas', () => {
  describe('registerSchema', () => {
    it('passes for valid registration input', () => {
      const valid = {
        email: 'admin@juris-banking.local',
        password: 'Password1234!',
        fullName: 'System Administrator',
        role: 'super_admin'
      };

      const result = registerSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('defaults role to case_manager when not specified', () => {
      const input = {
        email: 'manager@firm.local',
        password: 'SecurePassword123',
        fullName: 'Case Handler'
      };

      const result = registerSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.role).toBe('case_manager');
      }
    });

    it('fails when email format is invalid', () => {
      const input = {
        email: 'invalid-email-address',
        password: 'ValidPassword123',
        fullName: 'Test User'
      };

      const result = registerSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('email');
      }
    });

    it('fails when password is less than 8 characters', () => {
      const input = {
        email: 'valid@example.com',
        password: 'short',
        fullName: 'Test User'
      };

      const result = registerSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('password');
      }
    });

    it('fails when role is not in allowed enum', () => {
      const input = {
        email: 'valid@example.com',
        password: 'SecurePassword123',
        fullName: 'Test User',
        role: 'unauthorized_super_hacker'
      };

      const result = registerSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('fails when fullName exceeds 100 characters', () => {
      const input = {
        email: 'valid@example.com',
        password: 'SecurePassword123',
        fullName: 'A'.repeat(101)
      };

      const result = registerSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('fullName');
      }
    });

    it('fails when password exceeds 128 characters', () => {
      const input = {
        email: 'valid@example.com',
        password: 'A'.repeat(129),
        fullName: 'Valid Name'
      };

      const result = registerSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toContain('password');
      }
    });

    it('fails when email exceeds 255 characters', () => {
      const input = {
        email: 'a'.repeat(250) + '@example.com',
        password: 'SecurePassword123',
        fullName: 'Valid Name'
      };

      const result = registerSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('loginSchema', () => {
    it('passes for valid login input', () => {
      const input = {
        email: 'user@example.com',
        password: 'SecretPassword'
      };

      const result = loginSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('fails when email is invalid', () => {
      const input = {
        email: 'bad-email',
        password: 'SecretPassword'
      };

      const result = loginSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('fails when password is empty', () => {
      const input = {
        email: 'valid@example.com',
        password: ''
      };

      const result = loginSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
