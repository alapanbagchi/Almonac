import type { DatabaseQuery } from '../db/pool'
import { dateField, integerField, rowRecord } from '../db/rows'

export interface RateLimitWindow {
  readonly count: number
  readonly windowStart: Date
}

/** Count one hit and return the window it landed in. */
export interface RateLimitStore {
  hit(keyHash: Buffer, windowSeconds: number, at: Date): Promise<RateLimitWindow>
}

/**
 * Fixed-window counters in the control database, so every API replica shares
 * one view of a subject's traffic. The upsert is a single statement: concurrent
 * requests increment the same row instead of racing a read and a write.
 */
export class RateLimitRepository implements RateLimitStore {
  constructor(private readonly db: DatabaseQuery) {}

  async hit(keyHash: Buffer, windowSeconds: number, at: Date): Promise<RateLimitWindow> {
    const result = await this.db.query(
      `insert into identity.rate_limit as counter (key_hash, window_start, count)
       values ($1, to_timestamp(floor(extract(epoch from $2::timestamptz) / $3::int) * $3::int), 1)
       on conflict (key_hash) do update
          set count = case
                when counter.window_start = excluded.window_start then counter.count + 1
                else 1
              end,
              window_start = excluded.window_start
       returning counter.count, counter.window_start`,
      [keyHash, at, windowSeconds],
    )
    const row = rowRecord(result.rows[0])
    return {
      count: integerField(row, 'count'),
      windowStart: dateField(row, 'window_start'),
    }
  }
}
