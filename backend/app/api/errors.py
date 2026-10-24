from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


async def validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """422 without `input`/`ctx`: FastAPI's default handler echoes them, passwords included."""
    detail = [{k: e[k] for k in ("type", "loc", "msg") if k in e} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": detail})
