import { Elysia, t } from 'elysia'
import type { AdminDependencies } from '../controllers/admin/dependencies'
import type { OrganisationIdentity } from '../controllers/admin/organisations/create-organisation'
import { createOrganisation } from '../controllers/admin/organisations/create-organisation'
import { getOrganisation } from '../controllers/admin/organisations/get-organisation'
import { listOrganisations } from '../controllers/admin/organisations/list-organisations'
import { adminContext, adminContextOf } from '../guards/admin-context'
import { authenticateBearer } from '../guards/bearer'
import { requestIdOf, type RequestServer } from '../shared/request'
import { pageQuery, pageSchema } from '../shared/pagination'
import {
  instant,
  name,
  nullable,
  routeDetail,
  slug,
  uuid,
} from '../shared/validation'

const organisationSchema = t.Object({
  id: t.String(),
  zitadelOrgId: nullable(t.String()),
  name,
  slug,
  status: t.Union([
    t.Literal('pending'),
    t.Literal('active'),
    t.Literal('suspended'),
    t.Literal('archived'),
  ]),
  provisionedAt: nullable(instant),
  createdAt: instant,
})

const organisationBody = t.Object({ name, slug })

/**
 * adminGuard's derive does not reach a consumer's routes in Elysia 2, so the
 * router registers the same authentication derivation on itself.
 */
function authenticate(d: AdminDependencies) {
  return async (context: {
    headers: Record<string, string | undefined>
    request: Request
    server: unknown
  }) => ({
    adminContext: adminContext(
      await authenticateBearer(context.headers.authorization, d.sessions, d.users),
      context.request,
      context.server as RequestServer | null,
      requestIdOf(context),
    ),
  })
}

export function organisationsRouter(d: AdminDependencies, identity?: OrganisationIdentity) {
  return new Elysia({ name: 'admin.organisations', prefix: '/v1/admin' })
    .derive(authenticate(d))
    .post(
      '/organisations',
      {
        body: organisationBody,
        response: { 201: organisationSchema },
        detail: routeDetail('Create an organisation'),
      },
      async (context) => {
        context.set.status = 201
        return createOrganisation(d, adminContextOf(context), context.body, identity)
      },
    )
    .get(
      '/organisations',
      {
        query: pageQuery,
        response: { 200: pageSchema(organisationSchema) },
        detail: routeDetail('List organisations'),
      },
      (context) => listOrganisations(d, adminContextOf(context), context.query),
    )
    .get(
      '/organisations/:organisationId',
      {
        params: t.Object({ organisationId: uuid }),
        response: { 200: organisationSchema },
        detail: routeDetail('Read an organisation'),
      },
      (context) => getOrganisation(d, adminContextOf(context), context.params.organisationId),
    )
}
