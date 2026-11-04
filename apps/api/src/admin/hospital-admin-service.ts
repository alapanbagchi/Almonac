import type { Pool } from 'pg'
import { AppError } from '../shared/errors'
import { hashToken, mintToken } from '../shared/tokens'
import { withTransaction, type DatabaseQuery } from '../db/pool'
import type { AuditSink } from '../audit/audit-writer'
import type { AuthorizationRepository } from '../access/authorization-repository'
import type { AdminRequestContext } from './admin-context'
import type { Hospital, HospitalDomain, HospitalRepository } from './hospital-repository'
import type { Page, PageRequest } from '../shared/pagination'
import type { OrganisationRepository } from './organisation-repository'
import { asAdminError, forbidden, notFound } from './admin-errors'

export class HospitalAdminService {
  constructor(
    private readonly pool: Pool,
    private readonly hospitals: HospitalRepository,
    private readonly organisations: OrganisationRepository,
    private readonly authorization: AuthorizationRepository,
    private readonly audit: AuditSink,
  ) {}

  async list(
    context: AdminRequestContext,
    organisationId: string,
    page: PageRequest,
  ): Promise<Page<Hospital>> {
    await this.requireOrganisationManage(context, organisationId)
    return this.hospitals.listByOrganisation(organisationId, page)
  }

  async create(
    context: AdminRequestContext,
    organisationId: string,
    input: { name: string; slug: string; timezone: string },
  ): Promise<Hospital> {
    await this.requireOrganisationManage(context, organisationId)
    return withTransaction(this.pool, async (db) => {
      let hospital: Hospital
      try {
        hospital = await this.hospitals.create({ organisationId, ...input }, db)
      } catch (error) {
        throw asAdminError(error)
      }
      await this.auditChange(
        context,
        organisationId,
        hospital.id,
        'hospital',
        hospital.id,
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
    rawDomain: string,
  ): Promise<{ domain: HospitalDomain; token: string }> {
    const hospital = await this.requireHospitalManage(context, hospitalId)
    const domain = normaliseDomain(rawDomain)
    const minted = mintToken()
    const created = await withTransaction(this.pool, async (db) => {
      let domainRecord: HospitalDomain
      try {
        domainRecord = await this.hospitals.addDomain(
          { hospitalId: hospital.id, domain, tokenHash: minted.tokenHash },
          db,
        )
      } catch (error) {
        throw asAdminError(error)
      }
      await this.auditChange(
        context,
        hospital.organisationId,
        hospital.id,
        'hospital_domain',
        domainRecord.id,
        'hospital.domain_added',
        db,
      )
      return domainRecord
    })
    return { domain: created, token: minted.token }
  }

  async verifyDomain(
    context: AdminRequestContext,
    hospitalId: string,
    domainId: string,
    token: string,
  ): Promise<HospitalDomain> {
    const hospital = await this.requireHospitalManage(context, hospitalId)
    if (token.length === 0 || token.length > 128) throw validation('Verification token is not valid.')
    return withTransaction(this.pool, async (db) => {
      const verified = await this.hospitals.verifyDomain(
        { hospitalId: hospital.id, domainId, tokenHash: hashToken(token), at: new Date() },
        db,
      )
      if (verified === null) {
        throw new AppError('DOMAIN_VERIFICATION_FAILED', 422, 'Domain verification failed.')
      }
      await this.auditChange(
        context,
        hospital.organisationId,
        hospital.id,
        'hospital_domain',
        verified.id,
        'hospital.domain_verified',
        db,
      )
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
      let updated: Hospital | null
      try {
        updated = await this.hospitals.setPrimaryDomain({ hospitalId, domainId, at: new Date() }, db)
      } catch (error) {
        throw asAdminError(error)
      }
      if (updated === null) throw notFound('Hospital not found.')
      await this.auditChange(
        context,
        hospital.organisationId,
        hospital.id,
        'hospital',
        hospital.id,
        'hospital.primary_domain_set',
        db,
      )
      return updated
    })
  }

  private async requireOrganisationManage(
    context: AdminRequestContext,
    organisationId: string,
  ): Promise<void> {
    const allowed =
      (await this.authorization.hasPlatformPermission(context.actor.id, 'platform.manage')) ||
      (await this.authorization.hasPermission(context.actor.id, 'hospital.manage', {
        organisationId,
      }))
    if (!allowed) throw forbidden()
  }

  private async requireHospitalManage(
    context: AdminRequestContext,
    hospitalId: string,
  ): Promise<Hospital> {
    const hospital = await this.hospitals.findById(hospitalId)
    if (hospital === null) throw notFound('Hospital not found.')
    const allowed =
      (await this.authorization.hasPlatformPermission(context.actor.id, 'platform.manage')) ||
      (await this.authorization.hasPermission(context.actor.id, 'hospital.manage', {
        organisationId: hospital.organisationId,
        hospitalId: hospital.id,
      }))
    if (!allowed) throw forbidden()
    return hospital
  }

  private async auditChange(
    context: AdminRequestContext,
    organisationId: string,
    hospitalId: string | null,
    resourceType: string,
    resourceId: string,
    reasonCode: string,
    db?: DatabaseQuery,
  ): Promise<void> {
    await this.audit.write({
      actorUserId: context.actor.id,
      actorType: 'user',
      sessionId: context.sessionId,
      organisationId,
      hospitalId,
      eventType: 'admin.change',
      outcome: 'success',
      targetType: resourceType,
      targetId: resourceId,
      requestId: context.requestId,
      reason: humanReason(reasonCode),
      reasonCode,
      ip: context.ip,
      userAgentHash: context.userAgentHash,
      metadata: { resource_type: resourceType, resource_id: resourceId },
    }, db)
  }
}

function normaliseDomain(value: string): string {
  const domain = value.trim().toLowerCase().replace(/\.$/, '')
  if (
    domain.length < 4 ||
    domain.length > 253 ||
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)
  ) {
    throw validation('Domain is not valid.')
  }
  return domain
}

function humanReason(code: string): string {
  return code.replace(/\./g, ' ').replace(/_/g, ' ').slice(0, 500)
}

function validation(message: string): AppError {
  return new AppError('VALIDATION_FAILED', 400, message)
}
