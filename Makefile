# Local development only. This target destroys both local database volumes.
SHELL := /bin/bash

COMPOSE := docker compose -f infrastructure/local/compose.yaml
API_DIR := apps/api

.PHONY: reset

# Wipe Zitadel and registry PostgreSQL, recreate the databases, then apply the
# control schema to both the development and test databases.
reset:
	@test -f infrastructure/local/.env || { echo "missing infrastructure/local/.env"; exit 1; }
	@test -f $(API_DIR)/.env || { echo "missing $(API_DIR)/.env"; exit 1; }
	@echo "Resetting local Zitadel and registry databases..."
	$(COMPOSE) down --volumes --remove-orphans
	$(COMPOSE) up --detach --wait --wait-timeout 300
	cd $(API_DIR) && bun run db:migrate
	cd $(API_DIR) && DATABASE_URL="$$(sed -n 's/^TEST_DATABASE_URL=//p' .env)" bun run db:migrate