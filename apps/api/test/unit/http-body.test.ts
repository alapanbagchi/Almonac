import { describe, expect, test } from 'bun:test'
import { readJsonBody, ResponseBodyError } from '../../src/shared/http-body'

function streamed(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })
}

describe('bounded JSON body reader', () => {
  test('parses a JSON body', async () => {
    expect(await readJsonBody(new Response('{"ok":true}'), 64)).toEqual({ ok: true })
  })

  test('treats an empty body as an empty object', async () => {
    expect(await readJsonBody(new Response(''), 64)).toEqual({})
  })

  test('rejects a declared length above the limit before reading', async () => {
    const response = new Response('{}', { headers: { 'content-length': '100' } })
    await expect(readJsonBody(response, 10)).rejects.toMatchObject({ reason: 'too-large' })
  })

  test('rejects a streamed body above the limit', async () => {
    const response = new Response(streamed('1234', '5678', '9'))
    await expect(readJsonBody(response, 8)).rejects.toMatchObject({ reason: 'too-large' })
  })

  test('rejects malformed JSON', async () => {
    const error = await readJsonBody(new Response('{'), 64).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ResponseBodyError)
    expect(error).toMatchObject({ reason: 'invalid-json' })
  })
})
