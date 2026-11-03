"""Server entrypoint."""

import uvicorn

from fupan.app import app  # noqa: F401 - re-exported for uvicorn --reload

if __name__ == "__main__":
    uvicorn.run("fupan.app:app", host="127.0.0.1", port=8000, reload=False)
