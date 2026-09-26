from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Chat Support System"
    environment: str = "development"

    database_url: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/chat_support"
    db_pool_size: int = 20
    db_max_overflow: int = 40
    db_pool_timeout: int = 30
    db_pool_recycle_seconds: int = 1800
    require_db_at_head: bool = False

    @property
    def effective_database_url(self) -> str:
        url = self.database_url
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg2://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
        return url

    # Empty defaults: set in .env. In development, unset values fall back to insecure dev defaults.
    jwt_secret_key: str = ""
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480

    cors_origins: str = "http://localhost:3000"
    cors_allow_all: bool = False

    super_admin_email: str = "admin@example.com"
    super_admin_password: str = ""

    # When false, startup seed only ensures the super admin user (no demo operators/members/projects).
    # When true, demo data is still skipped if the database already has at least one project.
    seed_demo_projects: bool = True

    # Chat timing / SLA (server-authoritative — see app/services/chat_session_service.py)
    chat_max_duration_seconds: int = 180
    first_response_sla_seconds: int = 60
    chat_session_sweep_interval_seconds: int = 5
    # Comma-separated list of phrases; a closing operator message is valid if it contains
    # ANY of these as a case-insensitive substring. Extend via env var without code changes.
    thank_you_phrases: str = "thank you"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

    @property
    def thank_you_phrases_list(self) -> list[str]:
        return [p.strip().lower() for p in self.thank_you_phrases.split(",") if p.strip()]

    @model_validator(mode="after")
    def _dev_secret_defaults(self) -> "Settings":
        if self.environment == "development":
            if not (self.jwt_secret_key or "").strip():
                self.jwt_secret_key = "change-me"
            if not (self.super_admin_password or "").strip():
                self.super_admin_password = "Admin@12345"
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


settings = Settings()
