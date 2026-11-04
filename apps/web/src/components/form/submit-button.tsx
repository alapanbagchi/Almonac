"use client";

import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";

export function SubmitButton({ disabled, ...props }: ComponentProps<typeof Button>) {
  const hydrated = useHydrated();
  return <Button {...props} type="submit" disabled={!hydrated || disabled} />;
}
