import nodemailer from 'nodemailer'
import type { InvitationMailer } from './invitation-service'

export interface SmtpMailerOptions {
  readonly smtpUrl: string
  readonly smtpUser: string | null
  readonly smtpPassword: string | null
  readonly from: string
  readonly webPublicOrigin: string
}

/**
 * Email is the only place an invitation token leaves the server. The link puts
 * the token in the fragment, so it is not sent in the HTTP request line or the
 * Referer header. The database stores only the SHA-256 hash.
 */
export function createSmtpMailer(options: SmtpMailerOptions): InvitationMailer {
  const transport = nodemailer.createTransport({
    url: options.smtpUrl,
    auth:
      options.smtpUser === null
        ? undefined
        : { user: options.smtpUser, pass: options.smtpPassword ?? '' },
  })
  return {
    async send(input) {
      const link = new URL('/invitations/accept', options.webPublicOrigin)
      link.hash = `token=${input.token}`
      const scope = input.hospitalName === null
        ? input.organisationName
        : `${input.hospitalName} at ${input.organisationName}`
      await transport.sendMail({
        from: options.from,
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
