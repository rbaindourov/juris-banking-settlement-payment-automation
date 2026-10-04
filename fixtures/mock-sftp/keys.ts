import crypto from 'node:crypto';

let cachedHostKey: string | null = null;

/**
 * Returns or generates a 2048-bit RSA PEM host private key for ssh2 server.
 */
export function getOrCreateHostKey(): string {
  if (cachedHostKey) {
    return cachedHostKey;
  }

  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
  });

  cachedHostKey = privateKey;
  return privateKey;
}
