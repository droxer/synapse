SANDBOX_REGISTRY := ghcr.io/droxer
SANDBOX_BASE_IMAGE := base
SANDBOX_IMAGES := default data_science browser

# Image version tags (override with SANDBOX_TAGS_<name>=vX)
SANDBOX_TAGS_base :=
SANDBOX_TAGS_default :=
SANDBOX_TAGS_data_science :=
SANDBOX_TAGS_browser := v3

.PHONY: backend web dev install install-backend install-web build-web build-sandbox push-sandbox migrate clean test lint format evals pre-commit lint-web test-web desktop build-desktop generate-favicons tui

# Start both backend and web concurrently
dev: install
	@echo "Starting backend and web..."
	$(MAKE) -j2 backend web

# Backend (FastAPI + uvicorn)
backend:
	cd backend && uv run python -m api.main

# TypeScript TUI client
tui:
	cd tui && node --experimental-strip-types src/index.ts

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
	cd backend && uv run python -m alembic upgrade head

# Production build
build-web:
	cd web && npm run build

# Generate favicon/icon assets from SVG sources
generate-favicons:
	cd backend && uv run --with pillow python ../web/scripts/generate_favicons.py

# Resolve the full image name with optional version tag
# e.g. browser -> ghcr.io/droxer/synapse-sandbox-browser:v3
sandbox_suffix = $(subst _,-,$(1))
sandbox_image = $(SANDBOX_REGISTRY)/synapse-sandbox-$(call sandbox_suffix,$(1))$(if $(SANDBOX_TAGS_$(1)),:$(SANDBOX_TAGS_$(1)),)

# Local tag for the base image (used as default BASE_IMAGE arg in derived Dockerfiles)
SANDBOX_BASE_LOCAL_TAG := synapse-sandbox-base

# Build sandbox Docker images (from container/ folder)
# Usage: make build-sandbox [SANDBOX=browser]
# Base image is always built first when building all images.
build-sandbox:
ifdef SANDBOX
ifeq ($(SANDBOX),$(SANDBOX_BASE_IMAGE))
	docker build -t $(call sandbox_image,$(SANDBOX_BASE_IMAGE)) \
		-t $(SANDBOX_BASE_LOCAL_TAG) \
		-f container/Dockerfile.$(SANDBOX_BASE_IMAGE) container
else
	docker build -t $(call sandbox_image,$(SANDBOX_BASE_IMAGE)) \
		-t $(SANDBOX_BASE_LOCAL_TAG) \
		-f container/Dockerfile.$(SANDBOX_BASE_IMAGE) container
	docker build -t $(call sandbox_image,$(SANDBOX)) \
		--build-arg BASE_IMAGE=$(SANDBOX_BASE_LOCAL_TAG) \
		-f container/Dockerfile.$(SANDBOX) container
endif
else
	docker build -t $(call sandbox_image,$(SANDBOX_BASE_IMAGE)) \
		-t $(SANDBOX_BASE_LOCAL_TAG) \
		-f container/Dockerfile.$(SANDBOX_BASE_IMAGE) container
	$(foreach img,$(SANDBOX_IMAGES),docker build -t $(call sandbox_image,$(img)) \
		--build-arg BASE_IMAGE=$(SANDBOX_BASE_LOCAL_TAG) \
		-f container/Dockerfile.$(img) container;)
endif

# Push sandbox Docker images to GHCR
# Usage: make push-sandbox [SANDBOX=browser]
push-sandbox:
ifdef SANDBOX
	@echo "Pushing sandbox image to:"
	@echo "  $(call sandbox_image,$(SANDBOX))"
else
	@echo "Pushing sandbox images to:"
	@echo "  $(call sandbox_image,$(SANDBOX_BASE_IMAGE))"
	@$(foreach img,$(SANDBOX_IMAGES),echo "  $(call sandbox_image,$(img))";)
endif
ifdef SANDBOX
	docker push $(call sandbox_image,$(SANDBOX))
else
	docker push $(call sandbox_image,$(SANDBOX_BASE_IMAGE))
	$(foreach img,$(SANDBOX_IMAGES),docker push $(call sandbox_image,$(img));)
endif

# Run backend tests
test:
	cd backend && uv run pytest

# Lint backend
lint:
	cd backend && uv run ruff check .

# Lint web
lint-web:
	cd web && npx eslint src/

# Run web tests
test-web:
	cd web && npm test

# Format backend
format:
	cd backend && uv run ruff format .

# Install pre-commit hooks
pre-commit:
	cd backend && uv run pre-commit install

# Run pre-commit on all files
pre-commit-all:
	cd backend && uv run pre-commit run --all-files

# Run agent evals (mock by default; use EVAL_ARGS for options)
# Examples:
#   make evals
#   make evals EVAL_ARGS="--backend live --case web_search_basic"
#   make evals EVAL_ARGS="--tags search --output report.json"
evals:
	cd backend && uv run python -m evals $(EVAL_ARGS)

# Tauri desktop app (dev mode)
desktop:
	cd web && npm run tauri:dev

# Build Tauri desktop app for production
build-desktop:
	cd web && npm run tauri:build

# Clean generated files
clean:
	rm -rf backend/.venv web/node_modules web/.next
