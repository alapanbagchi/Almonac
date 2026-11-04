import { Elysia, t } from 'elysia'
import type { AdminDependencies } from '../controllers/admin/dependencies'
import { createOrganisation } from '../controllers/admin/organisations/create-organisation'
import { getOrganisation } from '../controllers/admin/organisations/get-organisation'
import { listOrganisations } from '../controllers/admin/organisations/list-organisations'
import { adminContextOf, adminGuard } from '../guards/admin-context'
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
  id: uuid,
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

export function organisationsRouter(d: AdminDependencies) {
  return new Elysia({ name: 'admin.organisations', prefix: '/v1/admin' })
    .use(adminGuard(d))
    .post(
      '/organisations',
      {
        body: organisationBody,
        response: { 201: organisationSchema },
        detail: routeDetail('Create an organisation'),
      },
      async (context) => {
        context.set.status = 201
        return createOrganisation(d, adminContextOf(context), context.body)
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