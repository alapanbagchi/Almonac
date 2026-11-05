import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { StepUpFailure } from "@/lib/auth/redirects";

const MESSAGES: Record<StepUpFailure, string> = {
  credentials: "The password is not correct. Try again.",
  denied: "This request did not come from Almonac. Try again from this page.",
  failed: "The identity check did not finish. Try again.",
  invalid: "That return address is not valid. Open the page again.",
  mfa: "This account requires multi-factor authentication, which is not available here.",
  session: "Your session ended before the check started. Sign in again.",
  unavailable: "The identity service is unavailable. Try again shortly.",
};

/**
 * Asks the signed-in member to confirm their identity again. The form posts to
 * the BFF, which checks the password and rotates the session on return.
 */
export function StepUpPrompt({
  returnTo,
  failure = null,
}: {
  returnTo: string;
  failure?: StepUpFailure | null;
}) {
  return (
    <form action="/api/auth/step-up" method="post" className="flex flex-col gap-4">
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-[1.35rem] leading-tight font-medium text-parchment">
          Confirm your identity
        </h2>
        <p className="text-[14px] leading-relaxed text-moss-bright">
          This action needs a recent sign-in. Enter your password to confirm it is you.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="step-up-password" className="text-[13px] font-medium text-parchment">
          Password
        </label>
        <Input
          id="step-up-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={1024}
          placeholder="Enter your password"
        />
      </div>
      {failure === null ? null : (
        <p
          role="alert"
          className="rounded-xl border border-clay/40 bg-clay/10 px-4 py-3 text-[13px] leading-relaxed text-parchment"
        >
          {MESSAGES[failure]}
        </p>
      )}
      <button
        type="submit"
        className={buttonVariants({
          className: "h-[48px] w-full rounded-xl text-[15px] font-semibold",
        })}
      >
        Verify again
      </button>
    </form>
  );
}
