import { Elysia, t } from 'elysia'
import { adminContextOf, type AdminDependencies } from './admin-context'
import {
  domainBody,
  domainSchema,
  hospitalBody,
  hospitalSchema,
  routeDetail,
  uuid,
  verifyDomainBody,
} from './admin-model'
import { domainResponse, hospitalResponse } from './admin-responses'
import { pageQuery, pageRequest, pageResponse, pageSchema, pageValues } from '../shared/pagination'

/** Hospitals and the verified domains that address them. */
export function hospitalRoutes(dependencies: AdminDependencies) {
  const { hospitals } = dependencies
  const hospitalParams = t.Object({ hospitalId: uuid })
  const domainParams = t.Object({ hospitalId: uuid, domainId: uuid })

  return new Elysia()
    .get(
      '/organisations/:organisationId/hospitals',
      {
        params: t.Object({ organisationId: uuid }),
        query: pageQuery,
        response: { 200: pageSchema(hospitalSchema) },
        detail: routeDetail('List hospitals'),
      },
      async (context) =>
        pageResponse(
          await hospitals.list(adminContextOf(context), context.params.organisationId, pageRequest(pageValues(context))),
          hospitalResponse,
        ),
    )
    .post(
      '/organisations/:organisationId/hospitals',
      {
        params: t.Object({ organisationId: uuid }),
        body: hospitalBody,
        response: { 201: hospitalSchema },
        detail: routeDetail('Create a hospital'),
      },
      async (context) => {
        const { name, slug, timezone } = context.body
        const hospital = await hospitals.create(
          adminContextOf(context),
          context.params.organisationId,
          { name, slug, timezone: timezone ?? 'UTC' },
        )
        context.set.status = 201
        return hospitalResponse(hospital)
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
        pageResponse(
          await hospitals.listDomains(adminContextOf(context), context.params.hospitalId, pageRequest(pageValues(context))),
          domainResponse,
        ),
    )
    .post(
      '/hospitals/:hospitalId/domains',
      {
        params: hospitalParams,
        body: domainBody,
        response: { 201: t.Object({ domain: domainSchema, token: t.String() }) },
        detail: routeDetail('Add a hospital domain'),
      },
      async (context) => {
        const created = await hospitals.addDomain(
          adminContextOf(context),
          context.params.hospitalId,
          context.body.domain,
        )
        context.set.status = 201
        return { domain: domainResponse(created.domain), token: created.token }
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
        domainResponse(
          await hospitals.verifyDomain(
            adminContextOf(context),
            context.params.hospitalId,
            context.params.domainId,
            context.body.token,
          ),
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
        hospitalResponse(
          await hospitals.setPrimaryDomain(
            adminContextOf(context),
            context.params.hospitalId,
            context.params.domainId,
          ),
        ),
    )
}
