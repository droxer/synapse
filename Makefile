SANDBOX_REGISTRY := ghcr.io/droxer
SANDBOX_IMAGES := default data_science browser

# Image version tags (override with SANDBOX_TAG=vX)
SANDBOX_TAGS_default :=
SANDBOX_TAGS_data_science :=
SANDBOX_TAGS_browser := v3

.PHONY: backend web dev install install-backend install-web build-web build-sandbox push-sandbox migrate clean test lint format evals

# Start both backend and web concurrently
dev: install
	@echo "Starting backend and web..."
	$(MAKE) -j2 backend web

# Backend (FastAPI + uvicorn)
backend:
	cd backend && uv run python -m api.main

# Web (Vite dev server)
web:
	cd web && npm run dev

# Install all dependencies
install: install-backend install-web

install-backend:
	cd backend && uv sync

install-web:
	cd web && npm install

# Database migrations
migrate:
	cd backend && uv run alembic upgrade head

# Production build
build-web:
	cd web && npm run build

# Resolve the full image name with optional version tag
# e.g. browser -> ghcr.io/droxer/hiagent-sandbox-browser:v3
sandbox_image = $(SANDBOX_REGISTRY)/hiagent-sandbox-$(1)$(if $(SANDBOX_TAGS_$(1)),:$(SANDBOX_TAGS_$(1)),)

# Build sandbox Docker images (from container/ folder)
# Usage: make build-sandbox [SANDBOX=browser]
build-sandbox:
ifdef SANDBOX
	docker build -t $(call sandbox_image,$(SANDBOX)) -f container/Dockerfile.$(SANDBOX) container
else
	$(foreach img,$(SANDBOX_IMAGES),docker build -t $(call sandbox_image,$(img)) -f container/Dockerfile.$(img) container;)
endif

# Push sandbox Docker images to GHCR
# Usage: make push-sandbox [SANDBOX=browser]
push-sandbox:
ifdef SANDBOX
	docker push $(call sandbox_image,$(SANDBOX))
else
	$(foreach img,$(SANDBOX_IMAGES),docker push $(call sandbox_image,$(img));)
endif

# Run backend tests
test:
	cd backend && uv run pytest

# Lint backend
lint:
	cd backend && uv run ruff check .

# Format backend
format:
	cd backend && uv run ruff format .

# Run agent evals (mock by default; use EVAL_ARGS for options)
# Examples:
#   make evals
#   make evals EVAL_ARGS="--backend live --case web_search_basic"
#   make evals EVAL_ARGS="--tags search --output report.json"
evals:
	cd backend && uv run python -m evals $(EVAL_ARGS)

# Clean generated files
clean:
	rm -rf backend/.venv web/node_modules web/.next
