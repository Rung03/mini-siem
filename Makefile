SHELL := /bin/bash
COMPOSE := docker compose
APPLIANCE := docker compose -f docker-compose.yml -f docker-compose.appliance.yml

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-16s\033[0m %s\n", $$1, $$2}'

# --- setup ------------------------------------------------------------------

.PHONY: env
env: ## Create .env from the SaaS template if it does not exist
	@test -f .env || (cp .env.saas.example .env && \
		echo "created .env from .env.saas.example - edit the passwords before a real deployment")

# --- running ----------------------------------------------------------------

.PHONY: up
up: env ## Build and start the stack (SaaS profile)
	$(COMPOSE) up -d --build
	@echo
	@echo "  http://localhost:8081    (plain)"
	@echo "  https://localhost:8443   (TLS, self-signed)"

.PHONY: appliance
appliance: env ## Start the appliance profile (everything on loopback)
	$(APPLIANCE) up -d --build

.PHONY: down
down: ## Stop the stack, keeping data
	$(COMPOSE) down

.PHONY: clean
clean: ## Stop the stack and delete all data
	$(COMPOSE) down -v

.PHONY: logs
logs: ## Follow the backend log
	$(COMPOSE) logs -f backend

.PHONY: ps
ps: ## Show container status
	$(COMPOSE) ps

# --- data -------------------------------------------------------------------

.PHONY: seed
seed: ## Load demo tenants, users, collectors and 24h of traffic
	$(COMPOSE) exec -T backend npm run seed:prod

.PHONY: geoip
geoip: ## Download the DB-IP Lite GeoIP database (optional, enables geo fields)
	./scripts/fetch-geoip.sh --with-asn
	$(COMPOSE) up -d --force-recreate backend

.PHONY: psql
psql: ## Open a psql shell as the superuser
	$(COMPOSE) exec db psql -U postgres -d siem

# --- sending samples --------------------------------------------------------

.PHONY: samples
samples: ## Send the syslog samples (set TOKEN=sk_... to also post the JSON ones)
	./samples/send_syslog.sh
	@if [ -n "$(TOKEN)" ]; then python samples/post_logs.py --token $(TOKEN); \
	 else echo; echo "TOKEN not set - skipping HTTP samples."; \
	      echo "Get one from Administration > Collectors, then: make samples TOKEN=sk_..."; fi

.PHONY: brute
brute: ## Send a burst of failed logins that trips the alert rule
	./samples/send_syslog.sh --brute

# --- checks -----------------------------------------------------------------

.PHONY: test
test: ## Run the full test suite against the running database
	cd backend && POSTGRES_HOST=localhost POSTGRES_PORT=$${DB_PUBLISH_PORT:-5433} npm test

.PHONY: typecheck
typecheck: ## Typecheck backend and frontend
	cd backend && npm run typecheck
	cd frontend && npm run typecheck

.PHONY: health
health: ## Check that the API is answering
	@curl -fsS http://localhost:8081/api/health && echo
