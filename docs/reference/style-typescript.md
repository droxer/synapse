# TypeScript (frontend) style

## Imports

Group related imports. Prefer path aliases: `@/features/...`, `@/shared/...`.

## Linting

`npx eslint src/` with the project’s Next.js-oriented rules (see `make lint-web`).

## Types

Strict mode (`tsc --noEmit`). Avoid `any`. Shared types live under `src/shared/types/`.

## Naming

- React components: `PascalCase.tsx`
- Hooks, utils, API modules: `kebab-case.ts`
- Variables and functions: `camelCase`
- Components, types, interfaces: `PascalCase`

## Errors and UI state

Prefer `async` / `await` with `try` / `catch`. Components should handle loading and error states explicitly.

## Related

- [Frontend layout](frontend-layout.md)
- [Makefile commands](commands.md)
