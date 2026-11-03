import { LOGIN_FAILURES, type LoginFailure } from "./redirects";

const MESSAGES: Record<LoginFailure, string> = {
  denied: "Sign-in was cancelled. Try again when you are ready.",
  expired: "That sign-in attempt expired. Start again to continue.",
  failed: "We could not sign you in. Try again.",
  invalid: "That sign-in request was not valid. Start again.",
  unavailable: "Sign-in is temporarily unavailable. Try again shortly.",
};

export function loginErrorMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const failure = LOGIN_FAILURES.find((candidate) => candidate === value);
  return failure === undefined ? null : MESSAGES[failure];
}
