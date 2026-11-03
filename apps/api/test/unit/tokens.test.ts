import { describe, expect, test } from 'bun:test'
import {
  SESSION_TOKEN_BYTES,
  hashToken,
  isSessionToken,
  mintToken,
} from '../../src/shared/tokens'

describe('opaque tokens', () => {
  test('mint 32 random bytes as unpadded base64url', () => {
    const { token, tokenHash } = mintToken()

    expect(SESSION_TOKEN_BYTES).toBe(32)
    expect(token).toHaveLength(43)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token).not.toContain('=')
    expect(isSessionToken(token)).toBe(true)
    expect(tokenHash).toHaveLength(32)
    expect(tokenHash).toEqual(hashToken(token))
  })

  test('never repeat a token', () => {
    const tokens = new Set(Array.from({ length: 1_000 }, () => mintToken().token))
    expect(tokens.size).toBe(1_000)
  })

  test('hash the same token to the same bytes', () => {
    const token = 'A'.repeat(43)
    expect(hashToken(token)).toEqual(hashToken(token))
  })

  test('hash different tokens to different bytes', () => {
    expect(hashToken('A'.repeat(43))).not.toEqual(hashToken('B'.repeat(43)))
  })

  test('reject malformed tokens before lookup', () => {
    for (const value of [
      undefined,
      null,
      '',
      'short',
      'A'.repeat(42),
      'A'.repeat(44),
      'A'.repeat(42) + '=',
      'A'.repeat(42) + '+',
      'A'.repeat(42) + '/',
      'A'.repeat(42) + ' ',
    ]) {
      expect(isSessionToken(value)).toBe(false)
    }
  })
})
