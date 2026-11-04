import type { AuthorizationRepository } from '../access/authorization-repository'
import { forbidden, notFound } from './admin-errors'
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
    if (!(await this.authorization.hasPlatformPermission(context.actor.id, 'platform.manage'))) {
      throw forbidden()
    }
    return this.provisioning.provision(input)
  }

  async list(context: AdminRequestContext, page: PageRequest): Promise<Page<Organisation>> {
    if (await this.authorization.hasPlatformPermission(context.actor.id, 'platform.manage')) {
      return this.organisations.listAll(page)
    }
    return this.organisations.listForUser(context.actor.id, page)
  }

  async get(context: AdminRequestContext, organisationId: string): Promise<Organisation> {
    const organisation = await this.organisations.findById(organisationId)
    if (organisation === null) throw notFound('Organisation not found.')
    const allowed =
      (await this.authorization.hasPlatformPermission(context.actor.id, 'platform.manage')) ||
      (await this.authorization.hasPermission(context.actor.id, 'organisation.manage', {
        organisationId,
      }))
    if (!allowed) throw forbidden()
    return organisation
  }
}
