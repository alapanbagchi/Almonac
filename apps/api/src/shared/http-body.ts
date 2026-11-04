/**
 * Read a JSON response body without trusting its size. The declared length is
 * checked before reading and the streamed body is capped by bytes, so a
 * provider cannot make the API buffer an unbounded response.
 */
export class ResponseBodyError extends Error {
  constructor(readonly reason: 'too-large' | 'invalid-json') {
    super(reason === 'too-large' ? 'response body is too large' : 'response body is not valid JSON')
    this.name = 'ResponseBodyError'
  }
}

export async function readJsonBody(response: Response, maxBytes: number): Promise<unknown> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (Number.isFinite(length) && length > maxBytes) throw new ResponseBodyError('too-large')
  }

  const reader = (response.body as ReadableStream<Uint8Array> | null)?.getReader()
  if (reader === undefined) return {}

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new ResponseBodyError('too-large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder().decode(body)
  if (text.length === 0) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new ResponseBodyError('invalid-json')
  }
}
