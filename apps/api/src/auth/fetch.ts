/** Minimal fetch surface so tests can supply a deterministic transport. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
