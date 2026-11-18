"""Assemble the Databricks App bundle: only the files the app needs at runtime.

    python scripts/build_bundle.py                 # -> build/app/
    python scripts/build_bundle.py --zip out.zip   # also write a zip for workspace import

Requires frontend/dist (run `npm run build` in frontend/ first). If ADMIN_EMAILS is set
in the environment, it replaces the placeholder in app.yaml, so the real admin login
never has to be committed.
"""
from __future__ import annotations

import os
import re
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build" / "app"
FILES = ["app.yaml", "app_run.py", "requirements.txt", "README.md", "migration/seed_dummy.py"]
DIRS = ["backend/app", "frontend/dist"]


def main() -> None:
    if not (ROOT / "frontend" / "dist" / "index.html").exists():
        sys.exit("frontend/dist is missing: run `npm run build` in frontend/ first")
    shutil.rmtree(OUT, ignore_errors=True)
    for f in FILES:
        (OUT / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / f, OUT / f)
    for d in DIRS:
        shutil.copytree(ROOT / d, OUT / d, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))

    admins = os.environ.get("ADMIN_EMAILS", "").strip()
    if admins:
        if not re.fullmatch(r"[^\s\",]+@[^\s\",]+(,[^\s\",]+@[^\s\",]+)*", admins):
            sys.exit("ADMIN_EMAILS must be comma-separated email addresses")
        spec = OUT / "app.yaml"
        text = spec.read_text(encoding="utf8")
        text, n = re.subn(r'(- name: "ADMIN_EMAILS"\s*\n\s*value: )"[^"]*"[^\n]*', rf'\1"{admins}"', text)
        if n != 1:
            sys.exit("could not find the ADMIN_EMAILS entry in app.yaml")
        spec.write_text(text, encoding="utf8")

    if "--zip" in sys.argv:
        target = Path(sys.argv[sys.argv.index("--zip") + 1]).resolve()
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
            paths = sorted(OUT.rglob("*"))
            for p in paths:  # folder entries first: the workspace importer needs them
                if p.is_dir():
                    z.writestr(p.relative_to(OUT).as_posix() + "/", "")
            for p in paths:
                if p.is_file():
                    z.write(p, p.relative_to(OUT).as_posix())
        print(f"wrote {target}")
    print(f"bundle ready in {OUT}")


if __name__ == "__main__":
    main()
