from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.exceptions import RequestValidationError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api import admin, annexes, auth, forms, journal, profiles, templates
from app.api.errors import validation_error
from app.db import get_db
from app.settings import settings


def create_app() -> FastAPI:
    docs = settings.expose_api_docs
    app = FastAPI(
        title="Pharmacie - fiches",
        docs_url="/api/docs" if docs else None,
        redoc_url="/api/redoc" if docs else None,
        openapi_url="/api/openapi.json" if docs else None,
    )
    app.add_exception_handler(RequestValidationError, validation_error)
    for module in (auth, profiles, templates, annexes, forms, journal, admin):
        app.include_router(module.router, prefix="/api")

    @app.get("/api/health")
    def health(db: Annotated[Session, Depends(get_db)]) -> dict[str, str]:
        db.execute(text("SELECT 1"))
        return {"status": "ok"}

    return app


app = create_app()
