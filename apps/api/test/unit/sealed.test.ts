import { describe, expect, test } from 'bun:test'
import { open, seal, sealingKey } from '../../src/shared/sealed'

const keyBytes = new Uint8Array(32).fill(7)
const key = sealingKey(1, keyBytes)
const aad = 'web_session.id_token_hint'

describe('sealed values', () => {
  test('round-trip with the same key and associated data', () => {
    const sealed = seal('header.payload.signature', key, aad)

    expect(sealed.keyVersion).toBe(1)
    expect(sealed.ciphertext).not.toContain(Buffer.from('header.payload.signature'))
    expect(open(sealed, key, aad)).toBe('header.payload.signature')
  })

  test('use a fresh nonce for every value', () => {
    const first = seal('same', key, aad).ciphertext
    const second = seal('same', key, aad).ciphertext
    expect(first).not.toEqual(second)
  })

  test('reject a modified byte', () => {
    const sealed = seal('secret', key, aad)
    const modified = Buffer.from(sealed.ciphertext)
    modified[modified.length - 1] = (modified[modified.length - 1] ?? 0) ^ 1

    expect(() => open({ ...sealed, ciphertext: modified }, key, aad)).toThrow()
  })

  test('reject a different associated data value', () => {
    const sealed = seal('secret', key, aad)
    expect(() => open(sealed, key, 'another context')).toThrow()
  })

  test('reject a different key', () => {
    const sealed = seal('secret', key, aad)
    const other = sealingKey(1, new Uint8Array(32).fill(8))
    expect(() => open(sealed, other, aad)).toThrow()
  })

  test('reject a different key version', () => {
    const sealed = seal('secret', key, aad)
    const other = sealingKey(2, keyBytes)
    expect(() => open(sealed, other, aad)).toThrow()
  })

  test('reject malformed envelopes and keys', () => {
    expect(() => seal('secret', key, aad)).not.toThrow()
    expect(() =>
      open({ ciphertext: Buffer.from('short'), keyVersion: 1 }, key, aad),
    ).toThrow('sealed value is malformed')

    const unsupported = Buffer.from(seal('secret', key, aad).ciphertext)
    unsupported[0] = 2
    expect(() => open({ ciphertext: unsupported, keyVersion: 1 }, key, aad)).toThrow(
      'unsupported format',
    )

    expect(() => sealingKey(0, keyBytes)).toThrow('version')
    expect(() => sealingKey(1, new Uint8Array(16))).toThrow('32 bytes')
  })
})
