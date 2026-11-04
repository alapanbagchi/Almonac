"use client";

import * as React from "react";

const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * False while the server renders and hydrates, true afterwards.
 *
 * A form that submits through React has no handler before hydration, so a
 * native submit would reload the page with its fields in the query string.
 * Gate the submit control on this value to keep it inert until React is ready.
 */
export function useHydrated(): boolean {
  return React.useSyncExternalStore(subscribe, onClient, onServer);
}
