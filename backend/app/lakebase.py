"""Lakebase (Databricks managed Postgres) OAuth-token provider.

Lakebase does not use a static password — the Postgres password is a short-lived
Databricks OAuth token (~1h). We mint one with the Databricks SDK (the app runs as
a service principal whose credentials the SDK picks up automatically) and inject it
as the connection password via SQLAlchemy's `do_connect` event, caching for ~45 min.
"""
from __future__ import annotations

import threading
import time
import uuid

_token: str | None = None
_expires_at: float = 0.0
_lock = threading.Lock()


def _fetch_token(instance_name: str) -> str:
    global _token, _expires_at
    with _lock:
        if _token and time.time() < _expires_at:
            return _token
        from databricks.sdk import WorkspaceClient
        w = WorkspaceClient()  # uses the app's injected service-principal creds
        cred = w.database.generate_database_credential(
            request_id=str(uuid.uuid4()), instance_names=[instance_name]
        )
        _token = cred.token
        _expires_at = time.time() + 45 * 60   # refresh well before the ~1h expiry
        return _token


def attach_token_provider(engine, instance_name: str) -> None:
    """Inject a fresh Lakebase token as the password on every new DBAPI connection."""
    from sqlalchemy import event

    @event.listens_for(engine, "do_connect")
    def _provide_password(dialect, conn_rec, cargs, cparams):  # noqa: ANN001
        cparams["password"] = _fetch_token(instance_name)


# --- OAuth-token-as-password (Lakebase projects in Databricks Apps) --------
_oauth_token: str | None = None
_oauth_expires_at: float = 0.0


def _oauth_password() -> str:
    """The app service principal's OAuth access token — used as the Postgres
    password for a Lakebase *project*. Config picks up DATABRICKS_CLIENT_ID/
    SECRET/HOST that Databricks Apps inject."""
    global _oauth_token, _oauth_expires_at
    with _lock:
        if _oauth_token and time.time() < _oauth_expires_at:
            return _oauth_token
        from databricks.sdk.core import Config
        _oauth_token = Config().oauth_token().access_token
        _oauth_expires_at = time.time() + 45 * 60
        return _oauth_token


def attach_oauth_password(engine) -> None:
    """Inject the SP OAuth token as the password on every new DBAPI connection."""
    from sqlalchemy import event

    @event.listens_for(engine, "do_connect")
    def _provide_password(dialect, conn_rec, cargs, cparams):  # noqa: ANN001
        cparams["password"] = _oauth_password()
