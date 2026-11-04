import { z } from "zod";

/** The API returns list endpoints as a page with an optional next offset. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextOffset: z.number().int().nonnegative().nullable(),
  });
}

export type Page<T> = { items: T[]; nextOffset: number | null };
