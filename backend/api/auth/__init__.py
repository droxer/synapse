"""Authentication package — re-exports common_dependencies for backward compat."""

from api.auth.middleware import AuthUser, common_dependencies, get_current_user

__all__ = ["AuthUser", "common_dependencies", "get_current_user"]
