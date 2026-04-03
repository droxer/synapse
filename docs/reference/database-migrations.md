# Database migrations

Run **Alembic** from the **`backend/`** directory.

```bash
cd backend

uv run alembic upgrade head
uv run alembic revision --autogenerate -m "description"
```

Apply migrations after pulling schema changes. Prefer autogenerate for local iteration; review generated revisions before committing.

## Related

- [Backend layout](backend-layout.md) (`agent/state/`, models)
- [Environment variables](environment.md) (`DATABASE_URL`)
