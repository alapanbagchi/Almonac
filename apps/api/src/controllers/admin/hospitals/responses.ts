import type { Hospital, HospitalDomain } from '../../../repositories/hospital-repository'
import { instant, maybeInstant } from '../../../shared/instant'

/** Dates become ISO strings; the route schema promises it. */
export function hospitalResponse(value: Hospital) {
  return { ...value, createdAt: instant(value.createdAt) }
}

export function domainResponse(value: HospitalDomain) {
  return {
    ...value,
    verifiedAt: maybeInstant(value.verifiedAt),
    retiredAt: maybeInstant(value.retiredAt),
    createdAt: instant(value.createdAt),
  }
}
