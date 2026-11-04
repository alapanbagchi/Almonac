import type { AuthorizationRepository } from '../access/authorization-repository'
import { forbidden, notFound } from '../shared/errors'
import { isPlatformAdmin, requireAdminPermission } from './admin-authorization'
import type { AdminRequestContext } from './admin-context'
import type { Page, PageRequest } from '../shared/pagination'
import type { Organisation, OrganisationRepository } from './organisation-repository'
import type { OrganisationProvisioningService } from './organisation-provisioning-service'

export class OrganisationAdminService {
  constructor(
    private readonly organisations: OrganisationRepository,
    private readonly authorization: AuthorizationRepository,
    private readonly provisioning: OrganisationProvisioningService,
  ) {}

  async create(context: AdminRequestContext, input: { name: string; slug: string }): Promise<Organisation> {
    if (!(await isPlatformAdmin(this.authorization, context.actor.id))) throw forbidden()
    return this.provisioning.provision(input)
  }

  async list(context: AdminRequestContext, page: PageRequest): Promise<Page<Organisation>> {
    return (await isPlatformAdmin(this.authorization, context.actor.id))
      ? this.organisations.listAll(page)
      : this.organisations.listForUser(context.actor.id, page)
  }

  async get(context: AdminRequestContext, organisationId: string): Promise<Organisation> {
    await requireAdminPermission(this.authorization, context.actor.id, 'organisation.manage', {
      organisationId,
    })
    const organisation = await this.organisations.findById(organisationId)
    if (organisation === null) throw notFound('Organisation not found.')
    return organisation
  }
}
