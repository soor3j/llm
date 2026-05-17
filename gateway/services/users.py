"""Redis-backed user registry for the workspace login flow.

This replaces the cosmetic "type your API key as password" experience with
real accounts. Users register with email + password and receive a generated
api_key that they use as the Bearer token for /v1/* endpoints.

Storage layout in Redis:
    user:by-email:<email>      HASH   per-user fields
    user:by-key:<api_key>      STRING email (reverse index for auth lookups)
    users:all                  SET    set of all registered emails
"""

import secrets
import time
from typing import Optional

import bcrypt
import structlog

log = structlog.get_logger()

_USER_HASH_PREFIX = "user:by-email:"
_KEY_INDEX_PREFIX = "user:by-key:"
_USERS_SET = "users:all"

API_KEY_PREFIX = "sk-"


def _generate_api_key() -> str:
    """Generate a 35-character API key prefixed with 'sk-' (OpenAI-style)."""
    return API_KEY_PREFIX + secrets.token_urlsafe(24)


class UserRegistry:
    def __init__(self, redis_client) -> None:
        self._redis = redis_client

    async def register(
        self, email: str, password: str, role: str = "user"
    ) -> dict:
        """Create a new user. Raises ValueError on conflict or bad input."""
        email = (email or "").strip().lower()
        if not email or "@" not in email:
            raise ValueError("valid email required")
        if not password or len(password) < 8:
            raise ValueError("password must be at least 8 characters")

        user_key = f"{_USER_HASH_PREFIX}{email}"
        if await self._redis.exists(user_key):
            raise ValueError("user already exists")

        api_key = _generate_api_key()
        pw_hash = bcrypt.hashpw(
            password.encode("utf-8"), bcrypt.gensalt()
        ).decode("ascii")
        now = str(int(time.time()))

        pipe = self._redis.pipeline()
        pipe.hset(
            user_key,
            mapping={
                "email": email,
                "api_key": api_key,
                "password_hash": pw_hash,
                "role": role,
                "created_at": now,
                "last_active": now,
            },
        )
        pipe.set(f"{_KEY_INDEX_PREFIX}{api_key}", email)
        pipe.sadd(_USERS_SET, email)
        await pipe.execute()

        log.info("user_registered", email=email, role=role)
        return {"email": email, "api_key": api_key, "role": role}

    async def authenticate(self, email: str, password: str) -> Optional[dict]:
        """Verify password and return user info on success, None on failure."""
        email = (email or "").strip().lower()
        if not email or not password:
            return None
        data = await self._redis.hgetall(f"{_USER_HASH_PREFIX}{email}")
        if not data:
            return None
        try:
            if not bcrypt.checkpw(
                password.encode("utf-8"),
                data["password_hash"].encode("ascii"),
            ):
                return None
        except (ValueError, KeyError):
            return None
        await self.touch_last_active(email)
        log.info("user_login", email=email)
        return {
            "email": data["email"],
            "api_key": data["api_key"],
            "role": data.get("role", "user"),
        }

    async def email_for_key(self, api_key: str) -> Optional[str]:
        """Reverse lookup: find which user owns this Bearer token."""
        if not api_key:
            return None
        return await self._redis.get(f"{_KEY_INDEX_PREFIX}{api_key}")

    async def role_for_key(self, api_key: str) -> Optional[str]:
        email = await self.email_for_key(api_key)
        if email is None:
            return None
        return await self._redis.hget(f"{_USER_HASH_PREFIX}{email}", "role")

    async def touch_last_active(self, email: str) -> None:
        await self._redis.hset(
            f"{_USER_HASH_PREFIX}{email.lower()}",
            "last_active",
            str(int(time.time())),
        )

    async def list_all(self) -> list[dict]:
        """Return all users with public fields (api_key masked)."""
        emails = await self._redis.smembers(_USERS_SET)
        out: list[dict] = []
        for em in sorted(emails):
            data = await self._redis.hgetall(f"{_USER_HASH_PREFIX}{em}")
            if not data:
                continue
            key = data.get("api_key", "")
            masked = (key[:7] + "…" + key[-4:]) if len(key) > 12 else "…"
            out.append(
                {
                    "email": data.get("email", em),
                    "role": data.get("role", "user"),
                    "created_at": int(data.get("created_at", 0)),
                    "last_active": int(data.get("last_active", 0)),
                    "api_key_masked": masked,
                }
            )
        return out
