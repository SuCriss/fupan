"""FastAPI application factory and static SPA mounting."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config as cfg, store
from .routers import api

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

WEB_DIST = cfg.ROOT_DIR / "web" / "dist"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    store.init_db()
    # Warm the snapshot in the background so the first page load does not wait
    # for a ~90s full-market build.
    store.refresh_in_background()
    yield


app = FastAPI(title="A股涨停复盘", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def _utf8_content_type(request, call_next):
    """Advertise UTF-8 explicitly so clients do not have to guess the charset."""
    response = await call_next(request)
    ct = response.headers.get("content-type", "")
    if ct.startswith("application/json") and "charset" not in ct:
        response.headers["content-type"] = "application/json; charset=utf-8"
    return response


app.include_router(api.router)


# Serve the built SPA when present, so one process can host everything.
if WEB_DIST.exists():
    assets = WEB_DIST / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(WEB_DIST / "index.html")

    @app.get("/favicon.svg")
    def favicon() -> FileResponse:
        icon = WEB_DIST / "favicon.svg"
        return FileResponse(icon) if icon.exists() else FileResponse(WEB_DIST / "index.html")
