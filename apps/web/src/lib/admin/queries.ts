"use client";

import { queryOptions } from "@tanstack/react-query";

import {
  getAuditLog,
  getBreakGlass,
  getFacilities,
  getOrganisations,
  getUsers,
} from "./actions";
import { unwrapAction } from "./result";

export const adminKeys = {
  all: ["admin"] as const,
  organisations: () => [...adminKeys.all, "organisations"] as const,
  facilities: (organisationId: string | null) =>
    [...adminKeys.all, "facilities", organisationId] as const,
  users: (organisationId: string | null) =>
    [...adminKeys.all, "users", organisationId] as const,
  audit: (organisationId: string | null, cursor: string | undefined) =>
    [...adminKeys.all, "audit", organisationId, cursor ?? null] as const,
  breakGlass: () => [...adminKeys.all, "break-glass"] as const,
};

export const organisationsQuery = () =>
  queryOptions({
    queryKey: adminKeys.organisations(),
    queryFn: () => unwrapAction(getOrganisations()),
  });

export const facilitiesQuery = (organisationId: string | null) =>
  queryOptions({
    queryKey: adminKeys.facilities(organisationId),
    queryFn: () => unwrapAction(getFacilities(organisationId)),
  });

export const usersQuery = (organisationId: string | null) =>
  queryOptions({
    queryKey: adminKeys.users(organisationId),
    queryFn: () => unwrapAction(getUsers(organisationId)),
  });

export const auditQuery = (organisationId: string | null, cursor: string | undefined) =>
  queryOptions({
    queryKey: adminKeys.audit(organisationId, cursor),
    queryFn: () => unwrapAction(getAuditLog(organisationId, cursor)),
  });

export const breakGlassQuery = () =>
  queryOptions({
    queryKey: adminKeys.breakGlass(),
    queryFn: () => unwrapAction(getBreakGlass()),
  });
