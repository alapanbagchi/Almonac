import { Elysia, t } from 'elysia'
import { adminContextOf, routeGroup, type AdminDependencies } from './admin-context'
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
import { pageRequest, pageResponse, pageSchema, paginationFields } from '../shared/pagination'

/** Hospitals and the verified domains that address them. */
export function hospitalRoutes(dependencies: AdminDependencies) {
  return routeGroup(
    new Elysia()
      .get(
        '/organisations/:organisationId/hospitals',
        {
          params: t.Object({ organisationId: uuid }),
          query: t.Object({ ...paginationFields }),
          response: { 200: pageSchema(hospitalSchema) },
          detail: routeDetail('List hospitals'),
        },
        async (context) => {
          const hospitals = await dependencies.hospitals.list(
            adminContextOf(context),
            context.params.organisationId,
            pageRequest(context.query),
          )
          return pageResponse(hospitals, hospitalResponse)
        },
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
          const hospital = await dependencies.hospitals.create(
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
          params: t.Object({ hospitalId: uuid }),
          query: t.Object({ ...paginationFields }),
          response: { 200: pageSchema(domainSchema) },
          detail: routeDetail('List hospital domains'),
        },
        async (context) => {
          const domains = await dependencies.hospitals.listDomains(
            adminContextOf(context),
            context.params.hospitalId,
            pageRequest(context.query),
          )
          return pageResponse(domains, domainResponse)
        },
      )
      .post(
        '/hospitals/:hospitalId/domains',
        {
          params: t.Object({ hospitalId: uuid }),
          body: domainBody,
          response: { 201: t.Object({ domain: domainSchema, token: t.String() }) },
          detail: routeDetail('Add a hospital domain'),
        },
        async (context) => {
          const { domain } = context.body
          const created = await dependencies.hospitals.addDomain(
            adminContextOf(context),
            context.params.hospitalId,
            domain,
          )
          context.set.status = 201
          return { domain: domainResponse(created.domain), token: created.token }
        },
      )
      .post(
        '/hospitals/:hospitalId/domains/:domainId/verify',
        {
          params: t.Object({ hospitalId: uuid, domainId: uuid }),
          body: verifyDomainBody,
          response: { 200: domainSchema },
          detail: routeDetail('Verify a hospital domain'),
        },
        async (context) => {
          const { token } = context.body
          return domainResponse(
            await dependencies.hospitals.verifyDomain(
              adminContextOf(context),
              context.params.hospitalId,
              context.params.domainId,
              token,
            ),
          )
        },
      )
      .post(
        '/hospitals/:hospitalId/domains/:domainId/primary',
        {
          params: t.Object({ hospitalId: uuid, domainId: uuid }),
          response: { 200: hospitalSchema },
          detail: routeDetail('Set the primary hospital domain'),
        },
        async (context) => hospitalResponse(
          await dependencies.hospitals.setPrimaryDomain(
            adminContextOf(context),
            context.params.hospitalId,
            context.params.domainId,
          ),
        ),
      ),
  )
}