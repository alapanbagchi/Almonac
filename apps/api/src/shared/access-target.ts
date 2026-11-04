/** The scope a permission is checked at. A hospital is optional and nullable. */
export interface AccessTarget {
  readonly organisationId: string
  readonly hospitalId?: string | null
}
