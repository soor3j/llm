"""Chat template registry for the inference engine.

Different model families expect different prompt formats. Sending Llama 3
the Mistral [INST] template (or vice versa) produces incoherent output —
the model has never seen those tokens during training. This module owns the
per-family prompt formatters and stop-token lists.

Supported families:
    mistral   — Mistral 7B Instruct, Mixtral
    llama3    — Llama 3, Llama 3.1, Llama 3.2 (instruct variants)
    qwen2     — Qwen 2, Qwen 2.5 (chatml-derived)
    chatml    — generic ChatML (Yi, some Qwen finetunes)
    phi3      — Microsoft Phi-3, Phi-3.5
    gemma     — Google Gemma 2

Pick one via CHAT_TEMPLATE in .env, or leave on "auto" to detect from the
MODEL_NAME / MODEL_FILE strings.
"""

from __future__ import annotations

from typing import Callable

from gateway.schemas import ChatMessage


# --------------------------------------------------------------------------
# Per-family formatters
# --------------------------------------------------------------------------

def _format_mistral(messages: list[ChatMessage]) -> str:
    """<s>[INST] {system}\n\n{user} [/INST] {assistant}</s>[INST] ..."""
    prompt = ""
    system_content = ""
    for msg in messages:
        if msg.role == "system":
            system_content = msg.content
        elif msg.role == "user":
            content = (
                f"{system_content}\n\n{msg.content}".strip()
                if system_content
                else msg.content
            )
            system_content = ""
            prompt += f"<s>[INST] {content} [/INST]"
        elif msg.role == "assistant":
            prompt += f" {msg.content}</s>"
    return prompt


def _format_llama3(messages: list[ChatMessage]) -> str:
    """Llama 3 / 3.1 / 3.2 chat template.

    <|begin_of_text|>
    <|start_header_id|>system<|end_header_id|>\n\n{system}<|eot_id|>
    <|start_header_id|>user<|end_header_id|>\n\n{user}<|eot_id|>
    <|start_header_id|>assistant<|end_header_id|>\n\n
    """
    parts = ["<|begin_of_text|>"]
    for msg in messages:
        if msg.role not in {"system", "user", "assistant"}:
            continue
        parts.append(
            f"<|start_header_id|>{msg.role}<|end_header_id|>\n\n"
            f"{msg.content}<|eot_id|>"
        )
    parts.append("<|start_header_id|>assistant<|end_header_id|>\n\n")
    return "".join(parts)


def _format_chatml(messages: list[ChatMessage]) -> str:
    """ChatML format used by Qwen, Yi, and several other models.

    <|im_start|>{role}\n{content}<|im_end|>\n
    """
    out: list[str] = []
    for msg in messages:
        if msg.role not in {"system", "user", "assistant"}:
            continue
        out.append(f"<|im_start|>{msg.role}\n{msg.content}<|im_end|>\n")
    out.append("<|im_start|>assistant\n")
    return "".join(out)


def _format_qwen2(messages: list[ChatMessage]) -> str:
    """Qwen 2 / 2.5 use ChatML with a default system if none given."""
    has_system = any(m.role == "system" for m in messages)
    if not has_system:
        messages = [
            ChatMessage(role="system", content="You are a helpful assistant.")
        ] + list(messages)
    return _format_chatml(messages)


def _format_phi3(messages: list[ChatMessage]) -> str:
    """Phi-3 / Phi-3.5: <|{role}|>\n{content}<|end|>\n with <|assistant|> open."""
    parts: list[str] = []
    for msg in messages:
        if msg.role not in {"system", "user", "assistant"}:
            continue
        parts.append(f"<|{msg.role}|>\n{msg.content}<|end|>\n")
    parts.append("<|assistant|>\n")
    return "".join(parts)


def _format_gemma(messages: list[ChatMessage]) -> str:
    """Gemma 2: <start_of_turn>{role}\n{content}<end_of_turn>\n.

    Gemma does NOT have a system role — system content is folded into the
    first user turn.
    """
    out: list[str] = []
    system_buf = ""
    for msg in messages:
        if msg.role == "system":
            system_buf = msg.content
        elif msg.role == "user":
            content = f"{system_buf}\n\n{msg.content}".strip() if system_buf else msg.content
            system_buf = ""
            out.append(f"<start_of_turn>user\n{content}<end_of_turn>\n")
        elif msg.role == "assistant":
            out.append(f"<start_of_turn>model\n{msg.content}<end_of_turn>\n")
    out.append("<start_of_turn>model\n")
    return "".join(out)


# --------------------------------------------------------------------------
# Registry
# --------------------------------------------------------------------------

# Each entry: (formatter, stop_tokens). The stop list goes to llama.cpp so
# generation stops the moment the model emits the family's end-of-turn marker.
TEMPLATES: dict[str, tuple[Callable[[list[ChatMessage]], str], list[str]]] = {
    "mistral": (_format_mistral, ["</s>", "[INST]"]),
    "llama3":  (_format_llama3,  ["<|eot_id|>", "<|end_of_text|>"]),
    "qwen2":   (_format_qwen2,   ["<|im_end|>", "<|endoftext|>"]),
    "chatml":  (_format_chatml,  ["<|im_end|>", "<|endoftext|>"]),
    "phi3":    (_format_phi3,    ["<|end|>", "<|endoftext|>"]),
    "gemma":   (_format_gemma,   ["<end_of_turn>", "<eos>"]),
}


# --------------------------------------------------------------------------
# Auto-detection
# --------------------------------------------------------------------------

def detect_template(model_name: str = "", model_path: str = "") -> str:
    """Pick a template by sniffing model_name and model_path.

    Returns the registry key. Falls back to 'mistral' so an unknown model
    using the historical default still works.
    """
    haystack = f"{model_name} {model_path}".lower()

    # Order matters — check more-specific patterns first.
    if "llama-3" in haystack or "llama3" in haystack:
        return "llama3"
    if "qwen" in haystack:
        return "qwen2"
    if "phi-3" in haystack or "phi3" in haystack:
        return "phi3"
    if "gemma" in haystack:
        return "gemma"
    if "mistral" in haystack or "mixtral" in haystack:
        return "mistral"
    return "mistral"


def resolve(
    requested: str,
    model_name: str = "",
    model_path: str = "",
) -> tuple[str, Callable[[list[ChatMessage]], str], list[str]]:
    """Return (template_name, formatter_fn, stop_tokens) for a given config.

    If ``requested`` is "auto" or unknown, auto-detection runs.
    """
    name = (requested or "auto").lower()
    if name not in TEMPLATES:
        name = detect_template(model_name, model_path)
    formatter, stops = TEMPLATES[name]
    return name, formatter, stops
