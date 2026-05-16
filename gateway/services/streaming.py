import json


def format_sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def format_sse_done() -> str:
    return "data: [DONE]\n\n"
