import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export const SEALING_KEY_BYTES = 32
const SEAL_FORMAT_VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16
const PREFIX_BYTES = 1 + IV_BYTES + TAG_BYTES

export interface SealingKey {
  readonly version: number
  readonly bytes: Buffer
}

export interface SealedValue {
  readonly ciphertext: Buffer
  readonly keyVersion: number
}

/**
 * Build a versioned AES-256-GCM key. The key must be exactly 32 bytes; a short
 * key would silently weaken the cipher.
 */
export function sealingKey(version: number, bytes: Uint8Array): SealingKey {
  if (!Number.isInteger(version) || version < 1 || version > 32_767) {
    throw new Error('sealing key version must be an integer between 1 and 32767')
  }
  if (bytes.byteLength !== SEALING_KEY_BYTES) {
    throw new Error('sealing key must be exactly 32 bytes')
  }
  return { version, bytes: Buffer.from(bytes) }
}

/**
 * Seal a small secret with the current key. The envelope is
 * version | nonce | tag | ciphertext. The key version is returned separately
 * because the database stores it in its own column.
 */
export function seal(
  plaintext: string,
  key: SealingKey,
  associatedData: string,
): SealedValue {
  const nonce = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key.bytes, nonce)
  cipher.setAAD(Buffer.from(associatedData, 'utf8'))

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const envelope = Buffer.concat([
    Buffer.from([SEAL_FORMAT_VERSION]),
    nonce,
    tag,
    ciphertext,
  ])

  return { ciphertext: envelope, keyVersion: key.version }
}

/**
 * Open a sealed value. A wrong key, wrong associated data, wrong format or a
 * modified byte fails closed: the caller never receives partial plaintext.
 */
export function open(
  sealed: SealedValue,
  key: SealingKey,
  associatedData: string,
): string {
  if (sealed.keyVersion !== key.version) {
    throw new Error('sealed value uses a different key version')
  }
  if (sealed.ciphertext.length < PREFIX_BYTES) {
    throw new Error('sealed value is malformed')
  }
  if (sealed.ciphertext[0] !== SEAL_FORMAT_VERSION) {
    throw new Error('sealed value uses an unsupported format')
  }

  const nonce = sealed.ciphertext.subarray(1, 1 + IV_BYTES)
  const tag = sealed.ciphertext.subarray(1 + IV_BYTES, PREFIX_BYTES)
  const ciphertext = sealed.ciphertext.subarray(PREFIX_BYTES)

  const decipher = createDecipheriv('aes-256-gcm', key.bytes, nonce)
  decipher.setAAD(Buffer.from(associatedData, 'utf8'))
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
