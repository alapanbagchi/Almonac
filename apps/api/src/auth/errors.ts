/** Identity-provider and login failures that are safe to map to an API code. */
export class OidcUnavailableError extends Error {
  constructor() {
    super('identity provider is unavailable')
    this.name = 'OidcUnavailableError'
  }
}

export class OidcRejectedError extends Error {
  constructor() {
    super('identity provider rejected the request')
    this.name = 'OidcRejectedError'
  }
}

export class InvalidIdTokenError extends Error {
  constructor(message = 'identity token is invalid') {
    super(message)
    this.name = 'InvalidIdTokenError'
  }
}

export class InvalidLoginAttemptError extends Error {
  constructor() {
    super('login attempt is invalid or expired')
    this.name = 'InvalidLoginAttemptError'
  }
}
