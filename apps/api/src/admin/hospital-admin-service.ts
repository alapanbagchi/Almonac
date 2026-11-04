import type { Pool } from 'pg'
import { hashToken, mintToken } from '../shared/tokens'
import { withTransaction, type DatabaseQuery } from '../db/pool'
import type { AuditSink } from '../audit/audit-writer'
import type { AuthorizationRepository } from '../access/authorization-repository'
import type { AdminRequestContext } from './admin-context'
import type { Hospital, HospitalDomain, HospitalRepository } from './hospital-repository'
import type { Page, PageRequest } from '../shared/pagination'
import { notFound, ruleViolation } from '../shared/errors'
import { requireAdminPermission } from './admin-authorization'
import { recordAdminChange } from './admin-audit'

export class HospitalAdminService {
  constructor(
    private readonly pool: Pool,
    private readonly hospitals: HospitalRepository,
    private readonly authorization: AuthorizationRepository,
    private readonly audit: AuditSink,
  ) {}

  async list(
    context: AdminRequestContext,
    organisationId: string,
    page: PageRequest,
  ): Promise<Page<Hospital>> {
    await this.requireManage(context, { organisationId })
    return this.hospitals.listByOrganisation(organisationId, page)
  }

  async create(
    context: AdminRequestContext,
    organisationId: string,
    input: { name: string; slug: string; timezone: string },
  ): Promise<Hospital> {
    await this.requireManage(context, { organisationId })
    return withTransaction(this.pool, async (db) => {
      const hospital = await this.hospitals.create({ organisationId, ...input }, db)
      await recordAdminChange(
        this.audit,
        context,
        { targetType: 'hospital', targetId: hospital.id, organisationId, hospitalId: hospital.id },
        'hospital.created',
        db,
      )
      return hospital
    })
  }

  async listDomains(
    context: AdminRequestContext,
    hospitalId: string,
    page: PageRequest,
  ): Promise<Page<HospitalDomain>> {
    const hospital = await this.requireHospitalManage(context, hospitalId)
    return this.hospitals.listDomains(hospital.id, page)
  }

  async addDomain(
    context: AdminRequestContext,
    hospitalId: string,
    domain: string,
  ): Promise<{ domain: HospitalDomain; token: string }> {
    const hospital = await this.requireHospitalManage(context, hospitalId)
    const minted = mintToken()
    const record = await withTransaction(this.pool, async (db) => {
      const record = await this.hospitals.addDomain(
        { hospitalId: hospital.id, domain, tokenHash: minted.tokenHash },
        db,
      )
      await this.recordDomain(context, db, hospital, record.id, 'hospital.domain_added')
      return record
    })
    return { domain: record, token: minted.token }
  }

  async verifyDomain(
    context: AdminRequestContext,
    hospitalId: string,
    domainId: string,
    token: string,
  ): Promise<HospitalDomain> {
    const hospital = await this.requireHospitalManage(context, hospitalId)
    return withTransaction(this.pool, async (db) => {
      const verified = await this.hospitals.verifyDomain(
        { hospitalId: hospital.id, domainId, tokenHash: hashToken(token), at: new Date() },
        db,
      )
      if (verified === null) throw ruleViolation('Domain verification failed.')
      await this.recordDomain(context, db, hospital, verified.id, 'hospital.domain_verified')
      return verified
    })
  }

  async setPrimaryDomain(
    context: AdminRequestContext,
    hospitalId: string,
    domainId: string,
  ): Promise<Hospital> {
    const hospital = await this.requireHospitalManage(context, hospitalId)
    return withTransaction(this.pool, async (db) => {
      const updated = await this.hospitals.setPrimaryDomain(
        { hospitalId, domainId, at: new Date() },
        db,
      )
      if (updated === null) throw notFound('Hospital not found.')
      await recordAdminChange(
        this.audit,
        context,
        {
          targetType: 'hospital',
          targetId: hospital.id,
          organisationId: hospital.organisationId,
          hospitalId: hospital.id,
        },
        'hospital.primary_domain_set',
        db,
      )
      return updated
    })
  }

  private requireManage(
    context: AdminRequestContext,
    target: { organisationId: string; hospitalId?: string },
  ): Promise<void> {
    return requireAdminPermission(this.authorization, context.actor.id, 'hospital.manage', target)
  }

  /** Hospital routes name a hospital, so resolving it and authorising it are one step. */
  private async requireHospitalManage(
    context: AdminRequestContext,
    hospitalId: string,
  ): Promise<Hospital> {
    const hospital = await this.hospitals.findById(hospitalId)
    if (hospital === null) throw notFound('Hospital not found.')
    await this.requireManage(context, { organisationId: hospital.organisationId, hospitalId })
    return hospital
  }

  private recordDomain(
    context: AdminRequestContext,
    db: DatabaseQuery,
    hospital: Hospital,
    domainId: string,
    reasonCode: string,
  ): Promise<void> {
    return recordAdminChange(
      this.audit,
      context,
      {
        targetType: 'hospital_domain',
        targetId: domainId,
        organisationId: hospital.organisationId,
        hospitalId: hospital.id,
      },
      reasonCode,
      db,
    )
  }
}
