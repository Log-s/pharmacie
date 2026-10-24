from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

SECRETS_DIR = Path("/run/secrets")


class Settings(BaseSettings):
    """Env vars override; secrets are read from compose secret files in /run/secrets/<field>."""

    model_config = SettingsConfigDict(
        secrets_dir=SECRETS_DIR if SECRETS_DIR.is_dir() else None  # absent outside compose
    )

    db_host: str = "db"
    db_port: int = 5432
    db_name: str = "pharmacie"
    db_user: str = "pharmacie"
    db_password: str
    secret_key: str
    expose_api_docs: bool = False  # /api/docs, /api/redoc, /api/openapi.json: development only
    annexes_dir: Path = Path("/data/annexes")
    annex_max_bytes: int = 20 * 1024 * 1024  # largest accepted annex upload
    session_idle_minutes: int = 30  # sliding: every authenticated request pushes expiry back
    login_rate_limit: int = 10  # login attempts per IP per minute
    lockout_threshold: int = 5  # consecutive failures before the account locks
    lockout_base_seconds: int = 60  # doubles with each further failure...
    lockout_max_seconds: int = 900  # ...up to this cap

    @property
    def database_url(self) -> URL:
        return URL.create(
            "postgresql+psycopg",
            username=self.db_user,
            password=self.db_password,
            host=self.db_host,
            port=self.db_port,
            database=self.db_name,
        )


settings = Settings()
