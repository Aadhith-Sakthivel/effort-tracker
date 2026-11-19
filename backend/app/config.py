"""Runtime configuration.

In Databricks Apps, Lakebase connection details arrive as environment variables.
Lakebase authenticates with a short-lived OAuth token (not a static password), so
when LAKEBASE_INSTANCE_NAME is set we fetch/refresh a token per connection
(see lakebase.py). Locally, with nothing configured, we fall back to SQLite.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Full SQLAlchemy URL wins if provided. Otherwise assembled from PG* parts.
    database_url: str | None = None

    pghost: str | None = None
    pgport: int = 5432
    pgdatabase: str = "effort_tracker"
    pguser: str | None = None
    pgpassword: str | None = None          # static password (optional)
    pgsslmode: str = "require"

    # Lakebase token mode: when set (and no static PGPASSWORD), the Postgres
    # password is a fresh Databricks OAuth token fetched for this instance.
    lakebase_instance: str | None = None

    # When running locally with no Postgres configured, use this SQLite file.
    sqlite_path: str = "ams_local.db"

    # Comma-separated allowed origins for cross-origin browser calls. Empty by
    # default: the SPA is served same-origin by this app, so no CORS is needed.
    # Set to the app URL only if another origin must call the API.
    cors_origins: str = ""

    # Comma-separated emails that always get the full-edit (lead) role — a bootstrap
    # so admins aren't locked out before resource emails are filled in.
    admin_emails: str | None = None

    def is_postgres(self) -> bool:
        return bool(self.database_url and "postgres" in self.database_url) or bool(self.pghost and self.pguser)

    def token_mode(self) -> bool:
        """True when we must mint a Lakebase OAuth token for the password."""
        return bool(self.lakebase_instance) and not self.pgpassword

    def resolve_url(self) -> str:
        if self.database_url:
            return self.database_url
        if self.pghost and self.pguser:
            pw = f":{self.pgpassword}" if self.pgpassword else ""   # omitted in token mode
            return (
                f"postgresql+psycopg://{self.pguser}{pw}"
                f"@{self.pghost}:{self.pgport}/{self.pgdatabase}"
                f"?sslmode={self.pgsslmode}"
            )
        return f"sqlite+pysqlite:///{self.sqlite_path}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
