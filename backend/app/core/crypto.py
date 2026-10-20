"""Fernet encryption for stored GitHub tokens."""
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from app.core.config import get_settings


def _fernet() -> Fernet:
    key = get_settings().token_encryption_key
    if not key:
        raise HTTPException(500, "TOKEN_ENCRYPTION_KEY is not configured on the server")
    return Fernet(key.encode())


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        raise HTTPException(500, "Stored GitHub token could not be decrypted. Reconnect the repository.")
