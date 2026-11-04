import nodemailer from 'nodemailer'
import type { InvitationMailer } from './invitation-types'

export interface SmtpMailerOptions {
  readonly smtpUrl: string
  readonly smtpUser: string | null
  readonly smtpPassword: string | null
  readonly from: string
  readonly fromName: string
  readonly requireTls: boolean
  readonly webPublicOrigin: string
}

/**
 * The transport fails rather than retrying silently. A call that needs the
 * message delivered (sign-up, invitation) surfaces the failure to the caller.
 * TLS 1.2 is the floor; production also requires STARTTLS on an smtp URL.
 */
function transportFor(options: SmtpMailerOptions) {
  return nodemailer.createTransport({
    url: options.smtpUrl,
    auth:
      options.smtpUser === null
        ? undefined
        : { user: options.smtpUser, pass: options.smtpPassword ?? '' },
    requireTLS: options.requireTls,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: 'TLSv1.2' },
    disableFileAccess: true,
    disableUrlAccess: true,
  })
}

function sender(options: SmtpMailerOptions): { name: string; address: string } {
  return { name: options.fromName, address: options.from }
}

/**
 * Email is the only place an invitation token leaves the server. The link puts
 * the token in the fragment, so it is not sent in the HTTP request line or the
 * Referer header. The database stores only the SHA-256 hash.
 */
export function createSmtpMailer(options: SmtpMailerOptions): InvitationMailer {
  const transport = transportFor(options)
  return {
    async send(input) {
      const link = new URL('/invitations/accept', options.webPublicOrigin)
      link.hash = `token=${input.token}`
      const scope = input.hospitalName === null
        ? input.organisationName
        : `${input.hospitalName} at ${input.organisationName}`
      await transport.sendMail({
        from: sender(options),
        to: input.to,
        subject: `You are invited to ${input.organisationName}`,
        text: [
          `You have been invited to join ${scope} on Almonac.`,
          '',
          `Accept the invitation: ${link.toString()}`,
          '',
          `The link expires on ${input.expiresAt.toISOString()}.`,
          'If you did not expect this invitation, ignore this message.',
        ].join('\n'),
      })
    },
  }
}

/**
 * The sign-up link proves control of the address before an identity exists.
 * The token is in the fragment, so it never reaches an HTTP request line or a
 * Referer header; the database stores only its SHA-256 hash.
 */
export function createVerificationMailer(options: SmtpMailerOptions): {
  send(input: { to: string; token: string; expiresAt: Date }): Promise<void>
} {
  const transport = transportFor(options)
  return {
    async send(input) {
      const link = new URL('/verify-email', options.webPublicOrigin)
      link.hash = `token=${input.token}`
      await transport.sendMail({
        from: sender(options),
        to: input.to,
        subject: 'Verify your Almonac email',
        text: [
          'Confirm your email address to finish creating your Almonac account.',
          '',
          `Verify the address: ${link.toString()}`,
          '',
          `The link expires on ${input.expiresAt.toISOString()}.`,
          'If you did not create an account, ignore this message.',
        ].join('\n'),
      })
    },
  }
}