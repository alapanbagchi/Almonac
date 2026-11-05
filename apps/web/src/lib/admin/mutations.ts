"use client";

import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { adminKeys } from "./queries";
import { unwrapAction, type ActionResult } from "./result";

/**
 * Every admin write refreshes the screen that made it. The default invalidation
 * covers all admin queries because one write can change several lists.
 */
export function useAdminMutation<TInput, TOutput>(
  action: (input: TInput) => Promise<ActionResult<TOutput>>,
  invalidate: QueryKey = adminKeys.all,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => unwrapAction(action(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invalidate }),
  });
}

/** A one-shot action outside the admin cache, such as accepting an invitation. */
export function useActionMutation<TInput, TOutput>(
  action: (input: TInput) => Promise<ActionResult<TOutput>>,
) {
  return useMutation({
    mutationFn: (input: TInput) => unwrapAction(action(input)),
  });
}
