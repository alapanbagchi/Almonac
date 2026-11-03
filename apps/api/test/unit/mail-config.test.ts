import { expect, test } from 'bun:test'
import { loadMailConfig, MailConfigError } from '../../src/admin/mail-config'

const valid = {
  NODE_ENV: 'development',
  SMTP_URL: 'smtp://127.0.0.1:1025',
  MAIL_FROM: 'no-reply@example.test',
  WEB_PUBLIC_ORIGIN: 'http://localhost:3000',
}

test('loads a local mail configuration without credentials', () => {
  expect(loadMailConfig(valid)).toEqual({
    smtpUrl: 'smtp://127.0.0.1:1025',
    smtpUser: null,
    smtpPassword: null,
    from: 'no-reply@example.test',
    webPublicOrigin: 'http://localhost:3000',
  })
})

test('rejects a half-configured SMTP login', () => {
  expect(() => loadMailConfig({ ...valid, SMTP_USER: 'mailer' })).toThrow(MailConfigError)
  expect(() => loadMailConfig({ ...valid, SMTP_PASSWORD: 'secret' })).toThrow(MailConfigError)
})

test('requires an https origin in production', () => {
  expect(() =>
    loadMailConfig({ ...valid, NODE_ENV: 'production', SMTP_URL: 'smtps://smtp.example.test:465' }),
  ).toThrow(MailConfigError)
})
