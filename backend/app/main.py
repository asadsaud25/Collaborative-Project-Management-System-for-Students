"""CPMS API entrypoint. Run: uvicorn app.main:app --reload --port 8000"""
import asyncio
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.api import api_router
from app.api.v1.endpoints.notifications import run_deadline_alerts
from app.core.config import get_settings
from app.core.database import get_db
from app.core.logging import get_logger, setup_logging
from app.services.realtime import manager

setup_logging()
log = get_logger("cpms")


async def _deadline_loop():
    while True:
        try:
            await asyncio.to_thread(run_deadline_alerts)
        except Exception:
            log.exception("deadline job failed")
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(_: FastAPI):
    manager.loop = asyncio.get_running_loop()
    task = asyncio.create_task(_deadline_loop())
    yield
    task.cancel()


app = FastAPI(title="CPMS API", version="1.0.0", lifespan=lifespan,
              description="Collaborative Project Management System for students and supervisors")

app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_list, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException):
    return JSONResponse({"error": {"code": exc.status_code, "message": exc.detail}}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(x) for x in first.get("loc", []) if x not in ("body", "query", "path"))
    details = [{"loc": [str(x) for x in e.get("loc", [])], "msg": str(e.get("msg", "")), "type": e.get("type", "")} for e in exc.errors()]
    return JSONResponse({"error": {"code": 422, "message": f"{where}: {first.get('msg', 'Invalid input')}".strip(": "), "details": details}},
                        status_code=422)


# Postgres error codes that mean "the request conflicts with the data", not "the server broke"
_DB_ERRORS = {
    "23505": (409, "That already exists."),
    "23503": (409, "This refers to something that does not exist or is still in use."),
    "23514": (422, "One of the values is not allowed."),
    "23502": (422, "A required value is missing."),
    "22P02": (422, "A value has the wrong format."),
    "42501": (403, "You do not have permission to do that."),
}


@app.exception_handler(APIError)
async def database_error(request: Request, exc: APIError):
    code = str(getattr(exc, "code", "") or "")
    msg = str(getattr(exc, "message", "") or exc)
    if "Milestone weights" in msg:
        return JSONResponse({"error": {"code": 422, "message": msg}}, status_code=422)
    if code in _DB_ERRORS:
        status, text = _DB_ERRORS[code]
        log.warning("database constraint", extra={"ctx": {"code": code, "path": request.url.path, "message": msg[:200]}})
        return JSONResponse({"error": {"code": status, "message": text}}, status_code=status)
    return await unhandled(request, exc)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    ref = uuid.uuid4().hex[:8]
    msg = str(exc)
    log.error("unhandled error", exc_info=exc, extra={"ctx": {"ref": ref, "path": request.url.path, "method": request.method}})
    # Friendly message for DB constraint failures (e.g. milestone weight trigger)
    if "Milestone weights" in msg:
        return JSONResponse({"error": {"code": 422, "message": msg}}, status_code=422)
    try:
        get_db().table("system_logs").insert({"level": "error", "message": f"{request.method} {request.url.path}: {msg[:300]}", "context": {"ref": ref}}).execute()
    except Exception:
        pass
    return JSONResponse({"error": {"code": 500, "message": f"Something went wrong on our side (ref {ref})."}}, status_code=500)


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok"}


app.include_router(api_router, prefix="/api/v1")
