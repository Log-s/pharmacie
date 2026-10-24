from typing import Annotated

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api import admin, annexes, auth, forms, journal, profiles, templates
from app.db import get_db


def create_app() -> FastAPI:
    app = FastAPI(
        title="Pharmacie - fiches", docs_url=None, redoc_url=None, openapi_url="/api/openapi.json"
    )
    for module in (auth, profiles, templates, annexes, forms, journal, admin):
        app.include_router(module.router, prefix="/api")

    @app.get("/api/health")
    def health(db: Annotated[Session, Depends(get_db)]) -> dict[str, str]:
        db.execute(text("SELECT 1"))
        return {"status": "ok"}

    return app


app = create_app()
