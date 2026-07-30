import { describe, it, expect } from 'vitest';
import { jwtVerify, SignJWT } from 'jose';

describe('Supabase JWT Secret', () => {
  it('should be set and long enough to be a valid JWT secret', () => {
    const secret = process.env.SUPABASE_JWT_SECRET ?? '';
    expect(secret.length).toBeGreaterThan(20);
  });

  it('should be able to sign and verify a JWT using the secret', async () => {
    const secret = process.env.SUPABASE_JWT_SECRET ?? '';
    const key = new TextEncoder().encode(secret);

    // Sign a test token
    const token = await new SignJWT({ sub: 'test-user-id', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(key);

    // Verify it
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    expect(payload.sub).toBe('test-user-id');
    expect(payload.role).toBe('authenticated');
  });
});
