"use client";

import * as React from "react";
import { Field as TanStackField, type AnyFieldApi, type AnyFormApi } from "@tanstack/react-form";
import type { ZodType } from "zod";

import { Shake } from "@/components/motion/shake";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";

/**
 * The default way a form field works in this app. Binds a TanStack Form field
 * to its label, validation state and error message in one place:
 *
 * - validates on blur and on submit with the given zod schema; typing in a
 *   pristine field never flags it, and once flagged the field revalidates live
 * - re-runs the blur validator on every change once flagged, so a fixed
 *   field clears immediately instead of staying red until the next blur
 * - the red border / red background come free from the Input and SelectTrigger
 *   primitives, which style `aria-invalid` by default
 * - a field that turns invalid shakes itself, independently of the whole form
 */
export interface ValidatedFieldRender {
  field: AnyFieldApi;
  invalid: boolean;
  error?: string;
  /** Spread onto `Input`. Already wired: id, value, handlers, aria props. */
  input: {
    id: string;
    name: string;
    value: string;
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onBlur: () => void;
    "aria-invalid": boolean;
    "aria-describedby"?: string;
  };
  /** Wiring for Base UI `Select`: root handlers plus trigger aria props. */
  select: {
    value: string;
    onValueChange: (value: unknown) => void;
    onOpenChange: (open: boolean) => void;
    triggerProps: {
      id: string;
      "aria-invalid": boolean;
      "aria-describedby"?: string;
    };
  };
}

/** A field revalidates live only once it has been flagged (blurred or submit). */
function shouldRevalidate(fieldApi: AnyFieldApi): boolean {
  return (
    fieldApi.state.meta.isBlurred ||
    fieldApi.form.state.submissionAttempts > 0
  );
}

/** First Zod issue message, or undefined when the value passes. */
function zodFirstError(schema: ZodType, value: unknown): string | undefined {
  const result = schema.safeParse(value);
  if (result.success) return undefined;
  return result.error.issues[0]?.message;
}

/**
 * Push a value into the field and keep every validation cause fresh, so a
 * fixed field clears immediately. Controls that bypass `input.onChange`
 * (e.g. the password meter) should call this instead of `handleChange`.
 */
export function updateFieldValue(field: AnyFieldApi, value: string): void {
  field.handleChange(value);
  if (shouldRevalidate(field)) field.validate("blur");
}

function firstErrorMessage(errors: ReadonlyArray<unknown>): string | undefined {
  for (const error of errors) {
    if (typeof error === "string" && error) return error;
    if (Array.isArray(error)) {
      const nested = firstErrorMessage(error);
      if (nested) return nested;
    } else if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string" &&
      error.message
    ) {
      return error.message;
    }
  }
  return undefined;
}

export function ValidatedField({
  form,
  name,
  label,
  schema,
  hint,
  id,
  children,
}: {
  form: AnyFormApi;
  name: string;
  label: string;
  /** Zod schema for this field. Omit for fields with no constraints. */
  schema?: ZodType;
  hint?: React.ReactNode;
  id?: string;
  children: (render: ValidatedFieldRender) => React.ReactNode;
}) {
  const autoId = React.useId();
  const inputId = id ?? `field-${autoId.replace(/[^a-zA-Z0-9-_]/g, "")}`;
  const errorId = `${inputId}-error`;
  // Stable identity: a fresh object every render makes concurrent blur and
  // submit validation runs clobber each other and drop one field error.
  const validators = React.useMemo(
    () =>
      schema
        ? {
            onChange: ({
              value,
              fieldApi,
            }: {
              value: unknown;
              fieldApi: AnyFieldApi;
            }) =>
              shouldRevalidate(fieldApi)
                ? zodFirstError(schema, value)
                : undefined,
            onBlur: schema,
          }
        : undefined,
    [schema]
  );

  return (
    <TanStackField form={form} name={name} validators={validators}>
      {(field: AnyFieldApi) => {
        const showError =
          field.state.meta.isBlurred ||
          field.form.state.submissionAttempts > 0;
        const error = showError ? firstErrorMessage(field.state.meta.errors) : undefined;
        const invalid = error !== undefined;
        const describedBy = error ? errorId : undefined;

        return (
          // A second submit with the same message still shakes.
          <Shake
            trigger={error}
            pulse={field.form.state.submissionAttempts}
            className="w-full"
          >
            <Field>
              <FieldLabel
                htmlFor={inputId}
                className={invalid ? "text-sm font-semibold text-destructive transition-colors" : "text-sm font-semibold text-foreground transition-colors"}
              >
                {label}
              </FieldLabel>
              {children({
                field,
                invalid,
                error,
                input: {
                  id: inputId,
                  name,
                  value: (field.state.value ?? "") as string,
                  onChange: (event) =>
                    updateFieldValue(field, event.target.value),
                  onBlur: () => field.handleBlur(),
                  "aria-invalid": invalid,
                  "aria-describedby": describedBy,
                },
                select: {
                  value: (field.state.value ?? "") as string,
                  onValueChange: (next) =>
                    updateFieldValue(field, String(next)),
                  onOpenChange: (open) => {
                    if (!open) field.handleBlur();
                  },
                  triggerProps: {
                    id: inputId,
                    "aria-invalid": invalid,
                    "aria-describedby": describedBy,
                  },
                },
              })}
              <FieldError
                errors={error ? [{ message: error }] : []}
                id={errorId}
                className="text-[13px] font-medium"
              />
              {!error && hint ? (
                <p className="text-[12px] leading-relaxed text-moss-bright">{hint}</p>
              ) : null}
            </Field>
          </Shake>
        );
      }}
    </TanStackField>
  );
}
