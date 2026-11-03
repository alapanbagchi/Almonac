import { AppError } from '../shared/errors'
import type { AuthorizationRepository } from '../access/authorization-repository'
import type { AdminRequestContext } from './admin-context'
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

  async list(context: AdminRequestContext): Promise<Organisation[]> {
    if (await this.authorization.hasPlatformPermission(context.actor.id, 'platform.manage')) {
      return this.organisations.listAll()
    }
    return this.organisations.listForUser(context.actor.id)
  }

  async get(context: AdminRequestContext, organisationId: string): Promise<Organisation> {
    const organisation = await this.organisations.findById(organisationId)
    if (organisation === null) throw notFound()
    const allowed =
      (await this.authorization.hasPlatformPermission(context.actor.id, 'platform.manage')) ||
      (await this.authorization.hasPermission(context.actor.id, 'organisation.manage', {
        organisationId,
      }))
    if (!allowed) throw forbidden()
    return organisation
  }
}

function forbidden(): AppError {
  return new AppError('FORBIDDEN', 403, 'You do not have permission for this action.')
}

function notFound(): AppError {
  return new AppError('NOT_FOUND', 404, 'Organisation not found.')
}
