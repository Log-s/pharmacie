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
    annexes_dir: Path = Path("/data/annexes")

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
