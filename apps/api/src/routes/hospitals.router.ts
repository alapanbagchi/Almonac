import { Elysia, t } from 'elysia'
import type { AdminDependencies } from '../controllers/admin/dependencies'
import { addDomain } from '../controllers/admin/hospitals/add-domain'
import { createHospital } from '../controllers/admin/hospitals/create-hospital'
import { listDomains } from '../controllers/admin/hospitals/list-domains'
import { listHospitals } from '../controllers/admin/hospitals/list-hospitals'
import { setPrimaryDomain } from '../controllers/admin/hospitals/set-primary-domain'
import { verifyDomain } from '../controllers/admin/hospitals/verify-domain'
import { adminContextOf, adminGuard } from '../guards/admin-context'
import { pageQuery, pageRequest, pageSchema } from '../shared/pagination'
import { domain, instant, name, nullable, routeDetail, slug, uuid } from '../shared/validation'

const hospitalSchema = t.Object({
  id: t.String(),
  organisationId: t.String(),
  name: t.String(),
  slug: t.String(),
  timezone: t.String(),
  status: t.Union([
    t.Literal('pending'),
    t.Literal('active'),
    t.Literal('suspended'),
    t.Literal('closed'),
  ]),
  primaryDomainId: nullable(t.String()),
  createdAt: instant,
})

const domainSchema = t.Object({
  id: t.String(),
  hospitalId: t.String(),
  domain: t.String(),
  verifiedAt: nullable(instant),
  retiredAt: nullable(instant),
  createdAt: instant,
})

const organisationParams = t.Object({ organisationId: uuid })
const hospitalParams = t.Object({ hospitalId: uuid })
const domainParams = t.Object({ hospitalId: uuid, domainId: uuid })

const createHospitalBody = t.Object({
  name,
  slug,
  timezone: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
})

const addDomainBody = t.Object({ domain })
const verifyDomainBody = t.Object({ token: t.String({ minLength: 1, maxLength: 128 }) })

/** Hospitals and the verified domains that address them. */
export function hospitalsRouter(d: AdminDependencies) {
  return new Elysia({ name: 'admin.hospitals', prefix: '/v1/admin' })
    .use(adminGuard(d))
    .get(
      '/organisations/:organisationId/hospitals',
      {
        params: organisationParams,
        query: pageQuery,
        response: { 200: pageSchema(hospitalSchema) },
        detail: routeDetail('List hospitals'),
      },
      async (context) =>
        listHospitals(
          d,
          adminContextOf(context),
          context.params.organisationId,
          pageRequest(context.query),
        ),
    )
    .post(
      '/organisations/:organisationId/hospitals',
      {
        params: organisationParams,
        body: createHospitalBody,
        response: { 201: hospitalSchema },
        detail: routeDetail('Create a hospital'),
      },
      async (context) => {
        const hospital = await createHospital(
          d,
          adminContextOf(context),
          context.params.organisationId,
          context.body,
        )
        context.set.status = 201
        return hospital
      },
    )
    .get(
      '/hospitals/:hospitalId/domains',
      {
        params: hospitalParams,
        query: pageQuery,
        response: { 200: pageSchema(domainSchema) },
        detail: routeDetail('List hospital domains'),
      },
      async (context) =>
        listDomains(d, adminContextOf(context), context.params.hospitalId, pageRequest(context.query)),
    )
    .post(
      '/hospitals/:hospitalId/domains',
      {
        params: hospitalParams,
        body: addDomainBody,
        response: { 201: t.Object({ domain: domainSchema, token: t.String() }) },
        detail: routeDetail('Add a hospital domain'),
      },
      async (context) => {
        const added = await addDomain(
          d,
          adminContextOf(context),
          context.params.hospitalId,
          context.body.domain,
        )
        context.set.status = 201
        return added
      },
    )
    .post(
      '/hospitals/:hospitalId/domains/:domainId/verify',
      {
        params: domainParams,
        body: verifyDomainBody,
        response: { 200: domainSchema },
        detail: routeDetail('Verify a hospital domain'),
      },
      async (context) =>
        verifyDomain(
          d,
          adminContextOf(context),
          context.params.hospitalId,
          context.params.domainId,
          context.body.token,
        ),
    )
    .post(
      '/hospitals/:hospitalId/domains/:domainId/primary',
      {
        params: domainParams,
        response: { 200: hospitalSchema },
        detail: routeDetail('Set the primary hospital domain'),
      },
      async (context) =>
        setPrimaryDomain(
          d,
          adminContextOf(context),
          context.params.hospitalId,
          context.params.domainId,
        ),
    )
}
