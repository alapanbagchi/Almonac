"use client"

/* eslint-disable react-hooks/refs -- the meter's stagger animation is driven
   by an intentional previous-score ref read during render; only animation
   order derives from it, so a concurrent tear would be invisible. */

import React, { useCallback, useEffect, useId, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { Eye } from "@/components/animate-ui/icons/eye"
import { EyeClosed } from "@/components/animate-ui/icons/eye-closed"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PasswordRule {
  /** Human-readable requirement shown in the checklist */
  label: string
  /** Returns true when the current value satisfies the rule */
  test: (value: string) => boolean
}

export interface PasswordStrengthInputProps {
  /** Controlled value. Leave undefined for uncontrolled usage */
  value?: string
  /** Initial value when uncontrolled. Default "" */
  defaultValue?: string
  /** Fires with the next value on every keystroke */
  onValueChange?: (value: string) => void
  /** Rules scored by the meter and listed in the checklist */
  rules?: PasswordRule[]
  /** Render the requirements checklist. Default true */
  showChecklist?: boolean
  /** Render the strength meter and label. Default false */
  showMeter?: boolean
  /** Placeholder of the input. Default "Enter password" */
  placeholder?: string
  /** Id of the input element */
  id?: string
  /** Name of the input element */
  name?: string
  /** Autocomplete hint of the input. Default "new-password" */
  autoComplete?: string
  /** Disables the input and the visibility toggle */
  disabled?: boolean
  /** Marks the input invalid (red border + tint via the Input primitive) */
  invalid?: boolean
  /** Extra ids appended to the meter id in aria-describedby */
  describedBy?: string
  /** Forwarded to the input element */
  onFocus?: React.FocusEventHandler<HTMLInputElement>
  /** Forwarded to the input element */
  onBlur?: React.FocusEventHandler<HTMLInputElement>
  /** Additional classes merged onto the wrapper */
  className?: string
  inputClassName?: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Mirrors PASSWORD_RULES in registration/registration-form so the standalone default
// matches what forms enforce.
export const DEFAULT_RULES: PasswordRule[] = [
  { label: "At least 8 characters", test: (value) => value.length >= 8 },
  { label: "One lowercase letter", test: (value) => /[a-z]/.test(value) },
  { label: "One uppercase letter", test: (value) => /[A-Z]/.test(value) },
  { label: "One number", test: (value) => /[0-9]/.test(value) },
  { label: "One symbol", test: (value) => /[^A-Za-z0-9]/.test(value) },
]

const SEGMENT_COUNT = 4
/** Delay between segments when several fill or empty in a single change */
const SEGMENT_STAGGER = 0.06
/** Check mark draw time once a rule flips to satisfied */
const CHECK_DRAW_DURATION = 0.2

const SEGMENT_SPRING = { type: "spring", stiffness: 500, damping: 32 } as const
const LABEL_SPRING = { type: "spring", stiffness: 400, damping: 30 } as const
const TOGGLE_SPRING = { type: "spring", stiffness: 500, damping: 30 } as const

// Indexed by score; score 0 shows no fill so its entry never renders.
// In-palette ramp: clay for weak, ascending moss to parchment for strong.
const SCORE_SEGMENT_CLASSES = [
  "bg-transparent", // unused (score 0)
  "bg-clay",
  "bg-moss",
  "bg-moss-bright",
  "bg-parchment",
] as const

const STRENGTH_LABELS = ["Too weak", "Too weak", "Fair", "Good", "Strong"] as const

const LABEL_CLASSES = [
  "text-moss/60",
  "text-clay",
  "text-moss",
  "text-moss-bright",
  "text-parchment",
] as const

const labelVariants = {
  enter: (direction: number) => ({ y: direction * 8, opacity: 0 }),
  center: { y: 0, opacity: 1 },
  exit: (direction: number) => ({ y: direction * -8, opacity: 0 }),
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PasswordStrengthInput({
  value: valueProp,
  defaultValue = "",
  onValueChange,
  rules = DEFAULT_RULES,
  showChecklist = true,
  showMeter = false,
  placeholder = "Enter password",
  id,
  name,
  autoComplete = "new-password",
  disabled = false,
  invalid = false,
  describedBy,
  onFocus,
  onBlur,
  className,
  inputClassName,
}: PasswordStrengthInputProps) {
  const shouldReduceMotion = useReducedMotion()
  const [internalValue, setInternalValue] = useState(defaultValue)
  const [visible, setVisible] = useState(false)

  const value = valueProp ?? internalValue
  const autoId = useId()
  const inputId = id ?? `${autoId}-password`
  const meterId = `${inputId}-strength`

  const satisfied = rules.map((rule) => rule.test(value))
  const satisfiedCount = satisfied.filter(Boolean).length
  // Strong requires every rule: with more rules than segments the raw
  // proportion would top out early (4/5 = Strong), so an incomplete set
  // is capped one below the maximum.
  const complete = rules.length > 0 && satisfiedCount >= rules.length
  const score =
    rules.length === 0
      ? 0
      : complete
        ? SEGMENT_COUNT
        : Math.min(
            Math.ceil((satisfiedCount / rules.length) * SEGMENT_COUNT),
            SEGMENT_COUNT - 1,
          )

  const strengthLabel = STRENGTH_LABELS[score]
  const fillClass = SCORE_SEGMENT_CLASSES[score]

  // The previous committed score decides which segments actually changed,
  // and the direction drives the label slide and the segment stagger order.
  const prevScoreRef = useRef(score)
  const prevScore = prevScoreRef.current
  const direction = score >= prevScore ? 1 : -1
  useEffect(() => {
    prevScoreRef.current = score
  }, [score])

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value
      if (valueProp === undefined) setInternalValue(next)
      onValueChange?.(next)
    },
    [valueProp, onValueChange],
  )

  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      {/* Input + visibility toggle */}
      <div className="relative">
        <Input
          type={visible ? "text" : "password"}
          id={inputId}
          name={name}
          value={value}
          onChange={handleChange}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={
            [describedBy, showMeter ? meterId : undefined]
              .filter((part): part is string => Boolean(part))
              .join(" ") || undefined
          }
          className={cn("bg-ink-raised pr-10 text-[15px] leading-5", inputClassName)}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className={cn(
            "absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 touch-manipulation select-none items-center justify-center rounded-md transition-colors",
            invalid ? "text-destructive" : "text-moss",
            invalid
              ? "hover:bg-bark hover:text-destructive active:bg-bark-raised"
              : "hover:bg-bark hover:text-parchment active:bg-bark-raised",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {/* Fixed 32px button + popLayout keep the swap free of layout shift;
              the icon scales from its own center */}
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={visible ? "hide" : "show"}
              className="inline-flex"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={shouldReduceMotion ? { duration: 0 } : TOGGLE_SPRING}
            >
              {visible ? (
                <EyeClosed size={16} aria-hidden="true" />
              ) : (
                <Eye size={16} aria-hidden="true" />
              )}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>

      {/* Strength meter + label */}
      {showMeter && (
        <div id={meterId} role="status" aria-live="polite">
          <span className="sr-only">Password strength: {strengthLabel}</span>
          <div className="flex items-center gap-3" aria-hidden="true">
            <div className="flex flex-1 gap-1.5">
              {Array.from({ length: SEGMENT_COUNT }).map((_, index) => {
                const filled = index < score
                const wasFilled = index < prevScore
                // Only segments whose fill state changed animate, staggered
                // outward from the previous score — 3→4 moves just the new
                // segment with zero delay (no replay of settled segments),
                // and a decrease empties only the removed ones right-to-left
                const order =
                  filled === wasFilled
                    ? 0
                    : direction > 0
                      ? index - Math.min(prevScore, score)
                      : Math.max(prevScore, score) - 1 - index
                return (
                  <div
                    key={index}
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-bark"
                  >
                    <motion.div
                      className={cn(
                        "h-full w-full origin-left rounded-full transition-colors duration-200",
                        fillClass,
                      )}
                      initial={false}
                      animate={{ scaleX: filled ? 1 : 0 }}
                      transition={
                        shouldReduceMotion
                          ? { duration: 0 }
                          : {
                              scaleX: {
                                ...SEGMENT_SPRING,
                                delay: order * SEGMENT_STAGGER,
                              },
                            }
                      }
                    />
                  </div>
                )
              })}
            </div>
            <span className="relative inline-grid h-4 shrink-0 items-center justify-items-end overflow-hidden">
              {/* Invisible spacers pin the column to the widest label so the
                  meter never shifts while the label crossfades */}
              {Array.from(new Set(STRENGTH_LABELS)).map((spacer) => (
                <span
                  key={spacer}
                  aria-hidden="true"
                  className="invisible col-start-1 row-start-1 text-xs font-medium"
                >
                  {spacer}
                </span>
              ))}
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.span
                  key={strengthLabel}
                  className={cn(
                    "col-start-1 row-start-1 text-xs font-medium transition-colors",
                    LABEL_CLASSES[score],
                  )}
                  custom={direction}
                  variants={labelVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={shouldReduceMotion ? { duration: 0 } : LABEL_SPRING}
                >
                  {strengthLabel}
                </motion.span>
              </AnimatePresence>
            </span>
          </div>
        </div>
      )}

      {/* Requirements checklist */}
      {showChecklist && rules.length > 0 && (
        <ul aria-label="Password requirements" className="flex flex-col gap-1.5">
          {rules.map((rule, index) => {
            const done = satisfied[index]
            return (
              <li
                key={rule.label}
                className={cn(
                  "flex items-center gap-2 text-[13px] transition-colors duration-200",
                  done ? "text-foreground" : "text-moss-bright",
                )}
              >
                <svg
                  viewBox="0 0 16 16"
                  className={cn(
                    "h-5 w-5 shrink-0",
                    done && "text-ink",
                  )}
                  aria-hidden="true"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="6.5"
                    strokeWidth="1.5"
                    className={cn(
                      "transition-colors duration-200",
                      done
                        ? "fill-parchment stroke-parchment"
                        : "fill-transparent stroke-moss/50",
                    )}
                  />
                  <motion.path
                    d="M4.5 8.5 7 11l4.5-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={false}
                    animate={{ pathLength: done ? 1 : 0, opacity: done ? 1 : 0 }}
                    transition={
                      shouldReduceMotion
                        ? { duration: 0 }
                        : {
                            pathLength: {
                              duration: CHECK_DRAW_DURATION,
                              ease: "easeOut",
                            },
                            opacity: { duration: 0.15 },
                          }
                    }
                  />
                </svg>
                <span>
                  {rule.label}
                  {done && <span className="sr-only"> satisfied</span>}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
