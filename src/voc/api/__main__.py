"""Entrypoint: python -m src.voc.api"""

import uvicorn

from src.voc.config import get_settings

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "src.voc.api.main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level.lower(),
    )
