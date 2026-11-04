import { expect, test } from 'bun:test'
import { loadMailConfig, MailConfigError } from '../../src/adapters/smtp/config'

const valid = {
  NODE_ENV: 'development',
  SMTP_URL: 'smtp://127.0.0.1:1025',
  MAIL_FROM: 'no-reply@example.test',
  WEB_PUBLIC_ORIGIN: 'http://localhost:3000',
}

const production = {
  NODE_ENV: 'production',
  SMTP_URL: 'smtps://smtp.example.test:465',
  SMTP_USER: 'mailer',
  SMTP_PASSWORD: 'secret',
  MAIL_FROM: 'no-reply@example.test',
  MAIL_FROM_NAME: 'Almonac',
  WEB_PUBLIC_ORIGIN: 'https://app.example.test',
}

test('loads a local mail configuration without credentials', () => {
  expect(loadMailConfig(valid)).toEqual({
    smtpUrl: 'smtp://127.0.0.1:1025',
    smtpUser: null,
    smtpPassword: null,
    from: 'no-reply@example.test',
    fromName: 'Almonac',
    webPublicOrigin: 'http://localhost:3000',
    requireTls: false,
  })
})

test('loads a production mail configuration over implicit TLS', () => {
  expect(loadMailConfig(production)).toEqual({
    smtpUrl: 'smtps://smtp.example.test:465',
    smtpUser: 'mailer',
    smtpPassword: 'secret',
    from: 'no-reply@example.test',
    fromName: 'Almonac',
    webPublicOrigin: 'https://app.example.test',
    requireTls: false,
  })
})

test('requires STARTTLS for an smtp URL in production', () => {
  const config = loadMailConfig({
    ...production,
    SMTP_URL: 'smtp://smtp.example.test:587',
  })
  expect(config.requireTls).toBe(true)
})

test('rejects a half-configured SMTP login', () => {
  expect(() => loadMailConfig({ ...valid, SMTP_USER: 'mailer' })).toThrow(MailConfigError)
  expect(() => loadMailConfig({ ...valid, SMTP_PASSWORD: 'secret' })).toThrow(MailConfigError)
})

test('requires SMTP credentials in production', () => {
  expect(() =>
    loadMailConfig({ ...production, SMTP_USER: undefined, SMTP_PASSWORD: undefined }),
  ).toThrow(MailConfigError)
})

test('rejects a loopback relay in production', () => {
  expect(() => loadMailConfig({ ...production, SMTP_URL: 'smtps://127.0.0.1:465' })).toThrow(
    MailConfigError,
  )
  expect(() => loadMailConfig({ ...production, SMTP_URL: 'smtps://localhost:465' })).toThrow(
    MailConfigError,
  )
})

test('rejects credentials inside the SMTP URL', () => {
  expect(() =>
    loadMailConfig({ ...valid, SMTP_URL: 'smtp://mailer:secret@127.0.0.1:1025' }),
  ).toThrow(MailConfigError)
})

test('rejects a multi-line sender name', () => {
  expect(() => loadMailConfig({ ...production, MAIL_FROM_NAME: 'Almonac\nBcc: x@y.test' })).toThrow(
    MailConfigError,
  )
})

test('requires an https origin in production', () => {
  expect(() => loadMailConfig({ ...production, WEB_PUBLIC_ORIGIN: 'http://app.example.test' })).toThrow(
    MailConfigError,
  )
})
