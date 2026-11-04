import "server-only";

export const MAX_BODY_BYTES = 8_192;

export class BodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large");
    this.name = "BodyTooLargeError";
  }
}

/**
 * Reads at most `limit` bytes, so a caller cannot stream an unbounded body
 * through a route handler.
 */
export async function readBoundedBody(
  request: Pick<Request, "headers" | "body">,
  limit = MAX_BODY_BYTES,
): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declared) || declared > limit) throw new BodyTooLargeError();
  if (request.body === null) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new BodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
