/**
 * The canonical error constructors live next to AppError. This module stays for
 * the imports that predate the move; new code imports from './errors'.
 */
export { conflict, forbidden, notFound, ruleViolation } from './errors'
