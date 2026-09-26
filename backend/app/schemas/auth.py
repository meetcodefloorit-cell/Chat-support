from pydantic import BaseModel, field_validator, model_validator

from app.schemas.user import UserOut


class LoginRequest(BaseModel):
    """Login: use 'email' or 'identifier'. Identifier = email or numeric access ID (operator/member)."""

    email: str | None = None
    identifier: str | None = None
    password: str = ""

    @field_validator("identifier")
    @classmethod
    def identifier_format(cls, v: str | None) -> str | None:
        if v is None or not str(v).strip():
            return v
        v = str(v).strip()
        if "@" in v or (v.isdigit() and 1 <= len(v) <= 16):
            return v
        raise ValueError("Identifier must be an email or a numeric access ID (digits only, up to 16)")

    @model_validator(mode="after")
    def require_identifier_and_password(self):
        ident = self.get_identifier()
        if not ident:
            raise ValueError("Provide either 'email' or 'identifier'")
        if not (self.password and self.password.strip()):
            raise ValueError("Password is required")
        return self

    def get_identifier(self) -> str:
        if self.identifier and str(self.identifier).strip():
            return str(self.identifier).strip()
        if self.email is not None and str(self.email).strip():
            return str(self.email).strip()
        return ""


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
