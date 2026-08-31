.PHONY: dev up down frontend logs migrate

COMPOSE = docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml

dev: up frontend

# Apply migrations to an already-running postgres (initdb only runs on a fresh volume).
# Idempotent — safe to re-run.
migrate:
	@for f in infra/migrations/*.sql; do \
		echo "applying $$f"; \
		$(COMPOSE) exec -T postgres psql -U attest_ai -d attest_ai < $$f; \
	done

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs -f

frontend:
	cd frontend && npm run dev
