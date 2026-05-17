from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    api_key: str
    admin_api_key: str = ""

    engine_host: str = "localhost"
    engine_port: int = 8001
    inference_backend: str = "llamacpp"

    model_name: str = "mistral-7b"
    model_path: str = "/models/mistral-7b-instruct-v0.2.Q4_K_M.gguf"
    context_length: int = 4096
    max_tokens_default: int = 512
    n_gpu_layers: int = 0

    # Chat template selector. "auto" detects from MODEL_NAME / MODEL_FILE; otherwise one of:
    # mistral, llama3, qwen2, chatml, phi3, gemma. Tells the engine which special tokens
    # and stop sequences to wrap the conversation in.
    chat_template: str = "auto"

    log_level: str = "INFO"
    workers: int = 4

    redis_host: str = "redis"
    redis_port: int = 6379

    cache_ttl_seconds: int = 3600
    max_cache_entries: int = 1000
    cache_similarity_threshold: float = 0.95

    rate_limit_rpm: int = 60

    alert_webhook_url: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
