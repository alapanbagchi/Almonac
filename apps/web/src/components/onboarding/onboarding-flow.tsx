"use client"

import * as React from "react"

import { Eye } from "@/components/animate-ui/icons/eye"
import { EyeClosed } from "@/components/animate-ui/icons/eye-closed"
import { ArrowLeft02 } from "@/components/animate-ui/icons/hugeicons/arrow-left-02"
import { ArrowRight02 } from "@/components/animate-ui/icons/hugeicons/arrow-right-02"
import { Home03 } from "@/components/animate-ui/icons/hugeicons/home-03"
import { Search01 } from "@/components/animate-ui/icons/hugeicons/search-01"
import { Stepper } from "@/components/onboarding/stepper"
import { SuccessIllustration } from "@/components/onboarding/success-illustration"
import { StatusBadge } from "@/components/spectrumui/status-badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

const ORGANISATION_TYPES = [
  "Hospital group",
  "Independent hospital",
  "Clinic",
  "Primary care network",
  "Other",
]

const ORGANISATION_SIZES = ["1–10", "11–50", "51–200", "201–1000", "1000+"]

const COUNTRIES = [
  "United States of America",
]

const HOSPITAL_TYPES = [
  "General hospital",
  "Specialist hospital",
  "Clinic",
  "Day surgery",
  "Diagnostic centre",
]

const TIME_ZONES = [
  "Europe/Dublin (GMT+1)",
  "Europe/London (GMT)",
  "Europe/Berlin (GMT+2)",
  "Europe/Paris (GMT+2)",
  "Europe/Madrid (GMT+2)",
  "America/New_York (GMT-4)",
]

const fieldGap = "flex flex-col gap-2"
const inputClass =
  "h-12 rounded-lg border-border bg-card px-3.5 text-[15px] placeholder:text-ash/70"
const selectClass =
  "h-12 w-full rounded-lg border-border bg-card px-3.5 text-[15px] data-[size=default]:h-12"

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className={fieldGap}>
      <Label htmlFor={htmlFor} className="text-[13px] font-semibold text-foreground">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-[12px] leading-relaxed text-ash">{hint}</p> : null}
    </div>
  )
}

function SelectField({
  label,
  value,
  onValueChange,
  options,
  placeholder,
}: {
  label: string
  value: string
  onValueChange: (value: string) => void
  options: string[]
  placeholder: string
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={(next) => onValueChange(String(next))}>
        <SelectTrigger className={selectClass}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

export function OnboardingFlow() {
  const [step, setStep] = React.useState(0)
  const [passwordVisible, setPasswordVisible] = React.useState(false)

  const [organisationName, setOrganisationName] = React.useState("")
  const [organisationType, setOrganisationType] = React.useState("")
  const [organisationCountry, setOrganisationCountry] = React.useState("")
  const [organisationSize, setOrganisationSize] = React.useState("")

  const [hospitalName, setHospitalName] = React.useState("")
  const [hospitalType, setHospitalType] = React.useState("")
  const [address, setAddress] = React.useState("")
  const [city, setCity] = React.useState("")
  const [region, setRegion] = React.useState("")
  const [hospitalCountry, setHospitalCountry] = React.useState("Ireland")
  const [timeZone, setTimeZone] = React.useState("Europe/Dublin (GMT+1)")

  const next = () => setStep((current) => Math.min(current + 1, 3))
  const back = () => setStep((current) => Math.max(current - 1, 0))

  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden bg-background">
      <img
        src="/onboarding/bg.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full object-cover"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-background/70 to-transparent"
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-7 sm:px-10 lg:px-16">
        <img src="/logo.svg" alt="Almonac" className="h-7 w-auto" />
        <p className="flex shrink-0 items-center gap-2 text-[12.5px] whitespace-nowrap text-ash">
          {step === 0 ? "Already have an account?" : "Need help?"}
          <a
            href="#"
            className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
          >
            {step === 0 ? "Sign in" : "Contact us"}
            <ArrowRight02 size={13} />
          </a>
        </p>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center px-6 pt-10 pb-16 sm:px-10">
        <div className="w-full max-w-[460px]">
          <Stepper current={step} />

          {step === 0 ? (
            <form
              className="mt-12 flex flex-col gap-6"
              onSubmit={(event) => {
                event.preventDefault()
                next()
              }}
            >
              <div className="flex flex-col gap-2.5">
                <h1 className="font-display text-[2.4rem] leading-[1.1] font-medium tracking-[-0.02em] text-foreground sm:text-[2.6rem]">
                  Create your account
                </h1>
                <p className="text-[14.5px] leading-relaxed text-ash">
                  One account for the hospitals and clinics you work with.
                </p>
              </div>

              <div className="flex flex-col gap-5">
                <Field label="Full name" htmlFor="full-name">
                  <Input
                    id="full-name"
                    name="fullName"
                    autoComplete="name"
                    placeholder="Dr. Jane Smith"
                    className={inputClass}
                    required
                  />
                </Field>

                <Field label="Work email" htmlFor="work-email">
                  <Input
                    id="work-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@clinic.com"
                    className={inputClass}
                    required
                  />
                </Field>

                <Field
                  label="Password"
                  htmlFor="password"
                  hint="Must be at least 8 characters with a mix of letters, numbers and symbols."
                >
                  <div className="relative">
                    <Input
                      id="password"
                      name="password"
                      type={passwordVisible ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Create a strong password"
                      className={cn(inputClass, "pr-11")}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setPasswordVisible((visible) => !visible)}
                      aria-label={passwordVisible ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ash transition-colors hover:text-foreground"
                    >
                      {passwordVisible ? <EyeClosed size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </Field>
              </div>

              <label
                htmlFor="terms"
                className="flex cursor-pointer items-start gap-2.5 select-none"
              >
                <Checkbox id="terms" className="mt-0.5" required />
                <span className="text-[12.5px] leading-relaxed text-charcoal">
                  I agree to the{" "}
                  <a href="#" className="text-foreground underline underline-offset-2">
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="#" className="text-foreground underline underline-offset-2">
                    Privacy Policy
                  </a>
                </span>
              </label>

              <Button type="submit" size="lg" className="h-12 w-full rounded-lg text-[14.5px] font-medium">
                Create account
                <ArrowRight02 size={16} />
              </Button>

              <p className="text-center text-[12px] text-ash/80">
                You can set up your organisation, hospital and invite your team next.
              </p>
            </form>
          ) : null}

          {step === 1 ? (
            <form
              className="mt-12 flex flex-col gap-6"
              onSubmit={(event) => {
                event.preventDefault()
                next()
              }}
            >
              <div className="flex flex-col gap-2.5">
                <h1 className="font-display text-[1.95rem] leading-[1.15] font-medium tracking-[-0.02em] text-foreground sm:text-[2.1rem]">
                  Tell us about your organisation
                </h1>
                <p className="max-w-[360px] text-[14.5px] leading-relaxed text-ash">
                  This helps us set up your workspace with the right settings and permissions.
                </p>
              </div>

              <div className="flex flex-col gap-5">
                <Field label="Organisation name" htmlFor="organisation-name">
                  <Input
                    id="organisation-name"
                    value={organisationName}
                    onChange={(event) => setOrganisationName(event.target.value)}
                    placeholder="e.g. City General Hospital"
                    className={inputClass}
                    required
                  />
                </Field>

                <SelectField
                  label="Organisation type"
                  value={organisationType}
                  onValueChange={setOrganisationType}
                  options={ORGANISATION_TYPES}
                  placeholder="Select organisation type"
                />

                <SelectField
                  label="Country"
                  value={organisationCountry}
                  onValueChange={setOrganisationCountry}
                  options={COUNTRIES}
                  placeholder="Select country"
                />

                <SelectField
                  label="Organisation size"
                  value={organisationSize}
                  onValueChange={setOrganisationSize}
                  options={ORGANISATION_SIZES}
                  placeholder="Select size"
                />
              </div>

              <div className="mt-1 flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={back}
                  className="h-12 flex-[0_0_30%] rounded-lg border-border bg-card text-[14.5px] font-medium"
                >
                  <ArrowLeft02 size={16} />
                  Back
                </Button>
                <Button
                  type="submit"
                  size="lg"
                  className="h-12 flex-1 rounded-lg text-[14.5px] font-medium"
                >
                  Continue
                  <ArrowRight02 size={16} />
                </Button>
              </div>
            </form>
          ) : null}

          {step === 2 ? (
            <form
              className="mt-12 flex flex-col gap-6"
              onSubmit={(event) => {
                event.preventDefault()
                next()
              }}
            >
              <div className="flex flex-col gap-2.5">
                <h1 className="font-display text-[1.95rem] leading-[1.15] font-medium tracking-[-0.02em] text-foreground sm:text-[2.1rem]">
                  Add your first hospital
                </h1>
                <p className="text-[14.5px] leading-relaxed text-ash">
                  Add a hospital or clinic to get started. You can add more later.
                </p>
              </div>

              <div className="flex flex-col gap-5">
                <Field label="Hospital name" htmlFor="hospital-name">
                  <Input
                    id="hospital-name"
                    value={hospitalName}
                    onChange={(event) => setHospitalName(event.target.value)}
                    placeholder="e.g. City General Hospital"
                    className={inputClass}
                    required
                  />
                </Field>

                <SelectField
                  label="Hospital type"
                  value={hospitalType}
                  onValueChange={setHospitalType}
                  options={HOSPITAL_TYPES}
                  placeholder="Select hospital type"
                />

                <Field label="Address" htmlFor="address">
                  <div className="relative">
                    <Input
                      id="address"
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      placeholder="Search for an address"
                      className={cn(inputClass, "pr-11")}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-0 flex w-11 items-center justify-center text-ash">
                      <Search01 size={16} />
                    </span>
                  </div>
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="City" htmlFor="city">
                    <Input
                      id="city"
                      value={city}
                      onChange={(event) => setCity(event.target.value)}
                      placeholder="e.g. Dublin"
                      className={inputClass}
                    />
                  </Field>
                  <Field label="State / Province" htmlFor="region">
                    <Input
                      id="region"
                      value={region}
                      onChange={(event) => setRegion(event.target.value)}
                      placeholder="e.g. Co. Dublin"
                      className={inputClass}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <SelectField
                    label="Country"
                    value={hospitalCountry}
                    onValueChange={setHospitalCountry}
                    options={COUNTRIES}
                    placeholder="Select country"
                  />
                  <SelectField
                    label="Time zone"
                    value={timeZone}
                    onValueChange={setTimeZone}
                    options={TIME_ZONES}
                    placeholder="Select time zone"
                  />
                </div>
              </div>

              <div className="mt-1 flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={back}
                  className="h-12 flex-[0_0_30%] rounded-lg border-border bg-card text-[14.5px] font-medium"
                >
                  <ArrowLeft02 size={16} />
                  Back
                </Button>
                <Button
                  type="submit"
                  size="lg"
                  className="h-12 flex-1 rounded-lg text-[14.5px] font-medium"
                >
                  Continue
                  <ArrowRight02 size={16} />
                </Button>
              </div>
            </form>
          ) : null}

          {step === 3 ? (
            <div className="mt-14 flex flex-col items-center">
              <SuccessIllustration className="h-[150px] w-auto text-line" />

              <div className="mt-6 flex flex-col items-center gap-2.5 text-center">
                <h1 className="font-display text-[1.9rem] leading-[1.15] font-medium tracking-[-0.02em] text-foreground sm:text-[2.05rem]">
                  You&rsquo;re all set
                </h1>
                <p className="max-w-[380px] text-[13.5px] leading-relaxed text-ash">
                  Your account, organisation and first hospital have been set up. You can now
                  start using Almonac.
                </p>
              </div>

              <div className="mt-8 flex w-full items-center gap-4 rounded-xl border border-border bg-card p-4">
                <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Home03 size={26} className="text-olive-deep" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="truncate text-[14px] font-semibold text-foreground">
                    {hospitalName || "City General Hospital"}
                  </p>
                  <p className="text-[12.5px] text-ash">
                    Hospital · {hospitalCountry || "Ireland"}
                  </p>
                  <p className="text-[12.5px] text-ash">
                    {timeZone || "Europe/Dublin (GMT+1)"}
                  </p>
                </div>
                <StatusBadge className="self-start">Active</StatusBadge>
              </div>

              <Button size="lg" className="mt-6 h-12 w-full rounded-lg text-[14.5px] font-medium">
                Go to dashboard
                <ArrowRight02 size={16} />
              </Button>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  )
}