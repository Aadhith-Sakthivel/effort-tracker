"""Databricks Apps entrypoint.

Run as `python app_run.py`. Databricks resolves `python` against the app's venv.
This adds `backend/` to the import path, reads the port Databricks assigns, and
starts uvicorn — avoiding shell PATH issues with the `uvicorn` console script.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

import uvicorn  # noqa: E402

if __name__ == "__main__":
    port = int(os.environ.get("DATABRICKS_APP_PORT") or os.environ.get("PORT") or 8000)
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, log_level="info")
