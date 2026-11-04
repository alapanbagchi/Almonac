/** Hash a password for the short window before the email is verified. */
export interface PasswordHasher {
  hash(password: string): Promise<string>
}

/** Zitadel accepts bcrypt hashes in modular crypt format. */
export const bcryptPasswordHasher: PasswordHasher = {
  hash: (password) => Bun.password.hash(password, { algorithm: 'bcrypt', cost: 10 }),
}
