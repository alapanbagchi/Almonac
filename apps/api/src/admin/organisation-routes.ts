import { Elysia, t } from 'elysia'
import { adminContextOf, type AdminDependencies } from './admin-context'
import { organisationBody, organisationSchema, routeDetail, uuid } from './admin-model'
import { organisationResponse } from './admin-responses'
import { pageQuery, pageRequest, pageResponse, pageSchema, pageValues } from '../shared/pagination'

/** Organisations: create, list and read. */
export function organisationRoutes(dependencies: AdminDependencies) {
  const { organisations } = dependencies

  return new Elysia()
    .post(
      '/organisations',
      {
        body: organisationBody,
        response: { 201: organisationSchema },
        detail: routeDetail('Create an organisation'),
      },
      async (context) => {
        const organisation = await organisations.create(adminContextOf(context), context.body)
        context.set.status = 201
        return organisationResponse(organisation)
      },
    )
    .get(
      '/organisations',
      {
        query: pageQuery,
        response: { 200: pageSchema(organisationSchema) },
        detail: routeDetail('List organisations'),
      },
      async (context) => {
        const page = await organisations.list(adminContextOf(context), pageRequest(pageValues(context)))
        return pageResponse(page, organisationResponse)
      },
    )
    .get(
      '/organisations/:organisationId',
      {
        params: t.Object({ organisationId: uuid }),
        response: { 200: organisationSchema },
        detail: routeDetail('Read an organisation'),
      },
      async (context) =>
        organisationResponse(await organisations.get(adminContextOf(context), context.params.organisationId)),
    )
}
