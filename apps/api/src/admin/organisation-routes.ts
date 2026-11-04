import { Elysia, t } from 'elysia'
import { adminContextOf, routeGroup, type AdminDependencies } from './admin-context'
import { organisationBody, organisationSchema, routeDetail, uuid } from './admin-model'
import { organisationResponse } from './admin-responses'
import { pageRequest, pageResponse, pageSchema, paginationFields } from '../shared/pagination'

/** Organisations: create, list and read. */
export function organisationRoutes(dependencies: AdminDependencies) {
  return routeGroup(
    new Elysia()
      .post(
        '/organisations',
        {
          body: organisationBody,
          response: { 201: organisationSchema },
          detail: routeDetail('Create an organisation'),
        },
        async (context) => {
          const { name, slug } = context.body
          const organisation = await dependencies.organisations.create(adminContextOf(context), {
            name,
            slug,
          })
          context.set.status = 201
          return organisationResponse(organisation)
        },
      )
      .get(
        '/organisations',
        {
          query: t.Object({ ...paginationFields }),
          response: { 200: pageSchema(organisationSchema) },
          detail: routeDetail('List organisations'),
        },
        async (context) => {
          const organisations = await dependencies.organisations.list(
            adminContextOf(context),
            pageRequest(context.query),
          )
          return pageResponse(organisations, organisationResponse)
        },
      )
      .get(
        '/organisations/:organisationId',
        {
          params: t.Object({ organisationId: uuid }),
          response: { 200: organisationSchema },
          detail: routeDetail('Read an organisation'),
        },
        async (context) => organisationResponse(
          await dependencies.organisations.get(adminContextOf(context), context.params.organisationId),
        ),
      ),
  )
}