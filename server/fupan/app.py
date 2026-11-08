"""FastAPI application factory and static SPA mounting."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import config as cfg, store
from .routers import api

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

WEB_DIST = cfg.ROOT_DIR / "web" / "dist"
SITE_BASE = "https://fupan.chrisite.eu.cc/"

# Vite emits content-hashed asset names, so a given /assets file never changes:
# it can be cached forever. The HTML shell is the opposite — every deploy rewrites
# the hashes, and a heuristically cached shell would request files that no longer
# exist, so it must revalidate on each visit.
CACHE_IMMUTABLE = "public, max-age=31536000, immutable"
CACHE_SHORT = "public, max-age=3600"
CACHE_REVALIDATE = "no-cache, must-revalidate"

NO_CACHE = {"Cache-Control": CACHE_REVALIDATE}
SHORT_CACHE = {"Cache-Control": CACHE_SHORT}


class _ImmutableStaticFiles(StaticFiles):
    """StaticFiles that marks successfully served build output as immutable."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = CACHE_IMMUTABLE
        return response


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
        app.mount("/assets", _ImmutableStaticFiles(directory=assets), name="assets")

    @app.get("/")
    def index() -> FileResponse:
        # The shell must revalidate: each deploy rewrites the asset hashes, and a
        # heuristically cached shell would ask for files that no longer exist.
        return FileResponse(WEB_DIST / "index.html", headers=NO_CACHE)

    @app.get("/favicon.svg")
    def favicon() -> FileResponse:
        icon = WEB_DIST / "favicon.svg"
        return FileResponse(icon, headers=SHORT_CACHE) if icon.exists() else FileResponse(WEB_DIST / "index.html", headers=NO_CACHE)

    @app.get("/robots.txt")
    def robots() -> FileResponse:
        f = WEB_DIST / "robots.txt"
        return FileResponse(f, headers=SHORT_CACHE) if f.exists() else FileResponse(WEB_DIST / "index.html", headers=NO_CACHE)

    @app.get("/manifest.webmanifest")
    def manifest() -> FileResponse:
        f = WEB_DIST / "manifest.webmanifest"
        if not f.exists():
            raise HTTPException(status_code=404, detail="manifest not built")
        return FileResponse(
            f, media_type="application/manifest+json", headers=SHORT_CACHE
        )

    @app.get("/sw.js")
    def service_worker() -> FileResponse:
        """The worker script itself must always be revalidated.

        A cached sw.js is never re-fetched, so a fixed worker would keep serving
        an old strategy forever; no-cache makes the browser check on every load.
        """
        f = WEB_DIST / "sw.js"
        if not f.exists():
            raise HTTPException(status_code=404, detail="service worker not built")
        return FileResponse(
            f,
            media_type="application/javascript",
            headers={"Cache-Control": CACHE_REVALIDATE, "Service-Worker-Allowed": "/"},
        )

    @app.get("/icon-{size}.png")
    def pwa_icon(size: str) -> FileResponse:
        # Sizes are fixed build artifacts; reject anything else so the route
        # cannot be used to read arbitrary files.
        if size not in ("192", "512", "512-maskable"):
            raise HTTPException(status_code=404, detail="no such icon")
        f = WEB_DIST / f"icon-{size}.png"
        if not f.exists():
            raise HTTPException(status_code=404, detail="icon not built")
        return FileResponse(f, media_type="image/png", headers=SHORT_CACHE)

    @app.get("/sitemap.xml")
    def sitemap() -> Response:
        """Dynamic sitemap: the home page plus one deep link per archive day."""
        parts = [
            f"<url><loc>{SITE_BASE}</loc>"
            "<changefreq>daily</changefreq><priority>1.0</priority></url>"
        ]
        for d in store.snapshot_dates(500):
            parts.append(
                f"<url><loc>{SITE_BASE}?date={d}</loc>"
                f"<lastmod>{d}</lastmod>"
                "<changefreq>never</changefreq><priority>0.8</priority></url>"
            )
        xml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            + "".join(parts)
            + "</urlset>"
        )
        return Response(content=xml, media_type="application/xml")
