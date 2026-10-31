#!/usr/bin/env python3
"""
Christian Prayer Live — multilingual Piper TTS worker.

- Discovers the Piper voices that are actually installed in
  config/piper/en (.onnx + .onnx.json) and config/piper/vn.
- Language aware: English messages are synthesised with an en-US voice,
  Vietnamese messages with a Vietnamese voice. English text is never sent
  through a Vietnamese-only sanitiser.
- Persistent process, one line of JSON in / one line of JSON out, so the Bun
  server keeps a warm model and the existing client TTS queue keeps working.
- Writes 22.05 kHz WAV files into data/tts-cache, with a content hash cache.

Run directly for a self test:
    .venv\\Scripts\\python.exe tts_worker.py --self-test
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
import traceback
import unicodedata
import wave
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "3")
os.environ.setdefault("OMP_WAIT_POLICY", "PASSIVE")

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / "data" / "tts-cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
VOICE_DIRS = {"en": ROOT / "config" / "piper" / "en", "vn": ROOT / "config" / "piper" / "vn"}
LANGUAGE_OF_DIR = {"en": "en", "vn": "vi"}

LABELS = {
    "en_US-amy-medium": "Amy — US English (female)",
    "en_US-arctic-medium": "Arctic — US English (male, multi-speaker)",
    "en_US-hfc_female-medium": "HFC — US English (female)",
    "vi_VN-vais1000-medium": "VAIS 1000 — Vietnamese (female)",
    "banmai": "Ban Mai — Vietnamese (female)",
    "cuc": "Cúc — Vietnamese (female)",
    "taian2": "Tài An — Vietnamese (male)",
    "phuongtrang": "Phương Trang — Vietnamese (female)",
    "ngochuyennew": "Ngọc Huyền (New) — Vietnamese (female)",
    "ngochuyen": "Ngọc Huyền — Vietnamese (female)",
    "minhquang": "Minh Quang — Vietnamese (male)",
    "minhkhang": "Minh Khang — Vietnamese (male)",
    "manhdung": "Mạnh Dũng — Vietnamese (male)",
    "maiphuong": "Mai Phương — Vietnamese (female)",
    "lacphi": "Lạc Phi — Vietnamese",
    "chieuthanh": "Chiêu Thanh — Vietnamese (southern)",
    "duyoryx3175": "Duy — Vietnamese",
}

EN_ALLOWED_RE = re.compile(r"[^0-9A-Za-z\u00C0-\u024F'’.,!?;:\-()\s]")
VI_ALLOWED_RE = re.compile(r"[^0-9a-zA-ZÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ\s.,!?;:'’-]")
VI_CHAR_RE = re.compile(r"[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]")
VIETNAMESE_WORDS = (
    "chung ta", "cau nguyen", "cầu nguyện", "xin chao", "xin chào", "quy vi",
    "quý vị", "chua", "chúa", "loi cau", "lời cầu", "binh an", "bình an",
)
BRACKET_RE = re.compile(r"\[[^\]]{1,32}\]")
URL_RE = re.compile(r"(https?://\S+|www\.\S+|\S+@\S+\.\S+)", re.IGNORECASE)
MULTI_PUNCT_RE = re.compile(r"([.,!?;:])\1+")
REPEATED_RE = re.compile(r"(.)\1{3,}", re.IGNORECASE)
SPACE_RE = re.compile(r"\s+")


def log(message: str) -> None:
    sys.stderr.write(f"[Piper] {message}\n")
    sys.stderr.flush()


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def discover_voices() -> list[dict]:
    """Find installed Piper models. Never assumes a filename."""
    voices: list[dict] = []
    for folder, language in LANGUAGE_OF_DIR.items():
        directory = VOICE_DIRS[folder]
        if not directory.is_dir():
            continue
        for model in sorted(directory.glob("*.onnx")):
            config = Path(f"{model}.json")
            if not config.is_file():
                continue
            meta = {}
            try:
                meta = json.loads(config.read_text("utf-8"))
            except Exception:  # noqa: BLE001
                meta = {}
            voice_id = model.stem
            voices.append(
                {
                    "id": voice_id,
                    "language": language,
                    "languageName": "English" if language == "en" else "Vietnamese",
                    "label": LABELS.get(voice_id, voice_id),
                    "path": str(model),
                    "config": str(config),
                    "sampleRate": int((meta.get("audio") or {}).get("sample_rate") or 22050),
                    "speakers": int(meta.get("num_speakers") or 1),
                    "espeakVoice": (meta.get("espeak") or {}).get("voice") or "",
                }
            )
    return voices


def detect_language(text: str, fallback: str = "en") -> str:
    lowered = text.lower()
    if VI_CHAR_RE.search(text):
        return "vi"
    if any(word in lowered for word in VIETNAMESE_WORDS):
        return "vi"
    return fallback if fallback in ("en", "vi") else "en"


def clean_text(raw: str, language: str) -> str:
    if not raw:
        return ""
    text = unicodedata.normalize("NFC", unicodedata.normalize("NFKC", str(raw)))
    text = BRACKET_RE.sub(" ", text)
    text = URL_RE.sub(" ", text)
    allowed = VI_ALLOWED_RE if language == "vi" else EN_ALLOWED_RE
    text = allowed.sub(" ", text)
    text = text.replace("’", "'").replace("“", '"').replace("”", '"')
    text = MULTI_PUNCT_RE.sub(r"\1", text)
    text = REPEATED_RE.sub(r"\1\1", text)
    text = SPACE_RE.sub(" ", text).strip(" .,!?;:-")

    letters = re.findall(r"[A-Za-zÀ-ỹ]", text)
    if len(letters) < 2:
        return ""
    if len(text) > 320:
        text = text[:320].rsplit(" ", 1)[0].strip()
    if text and text[-1] not in ".!?;:":
        text += "."
    return text


class PiperEngine:
    def __init__(self) -> None:
        self.voices = discover_voices()
        self.by_id = {v["id"]: v for v in self.voices}
        self.loaded: dict[str, object] = {}
        self.load_order: list[str] = []
        self.default_en = self.resolve_default("en")
        self.default_vi = self.resolve_default("vi")
        self.engine = "piper"

    def resolve_default(self, language: str) -> str | None:
        env_name = "DEFAULT_EN_VOICE" if language == "en" else "DEFAULT_VN_VOICE"
        configured = (os.environ.get(env_name) or "auto").strip()
        candidates = [v for v in self.voices if v["language"] == language]
        if not candidates:
            return None
        if configured and configured != "auto":
            for voice in candidates:
                if voice["id"] == configured:
                    return voice["id"]
        preferred = "en_US-amy-medium" if language == "en" else "vi_VN-vais1000-medium"
        for voice in candidates:
            if voice["id"] == preferred:
                return voice["id"]
        return candidates[0]["id"]

    def select_voice(self, requested: str, language: str) -> dict | None:
        candidates = [v for v in self.voices if v["language"] == language]
        if not candidates:
            return None
        if requested and requested != "auto":
            for voice in candidates:
                if voice["id"] == requested:
                    return voice
        default_id = self.default_en if language == "en" else self.default_vi
        if default_id and default_id in self.by_id:
            return self.by_id[default_id]
        return candidates[0]

    def load_voice(self, voice: dict):
        from piper import PiperVoice

        voice_id = voice["id"]
        if voice_id in self.loaded:
            return self.loaded[voice_id]
        started = time.time()
        model = PiperVoice.load(voice["path"], config_path=voice["config"])
        self.loaded[voice_id] = model
        self.load_order.append(voice_id)
        # Keep at most two models resident (English + Vietnamese) to stay light.
        while len(self.load_order) > 2:
            stale = self.load_order.pop(0)
            self.loaded.pop(stale, None)
        log(f"loaded {voice_id} in {time.time() - started:.2f}s")
        return model

    def synthesize(self, text: str, lang: str, voice_id: str, rate: float) -> dict:
        language = lang if lang in ("en", "vi") else detect_language(text)
        voice = self.select_voice(voice_id, language)
        if not voice:
            return {"ok": False, "error": f"No {language} Piper voice installed"}

        normalised = clean_text(text, language)
        if not normalised:
            return {"ok": False, "error": "Filtered empty or unsupported text"}

        rate = max(0.6, min(1.6, float(rate or 1.0)))
        cache_key = hashlib.sha1(
            f"piper2::{voice['id']}::{language}::{rate:.2f}::{normalised}".encode("utf-8")
        ).hexdigest()[:20]
        out_name = f"{voice['id']}_{cache_key}.wav"
        out_path = CACHE_DIR / out_name

        if out_path.is_file() and out_path.stat().st_size > 200:
            duration = wav_duration(out_path)
            return {
                "ok": True,
                "cached": True,
                "voice": voice["id"],
                "language": language,
                "file": out_name,
                "url": f"/tts-cache/{out_name}",
                "durationSec": duration,
                "synthSec": 0.0,
                "sampleRate": voice["sampleRate"],
                "text": normalised,
            }

        started = time.time()
        model = self.load_voice(voice)
        from piper import SynthesisConfig

        temp_path = out_path.with_suffix(".tmp.wav")
        config = SynthesisConfig(length_scale=1.0 / rate, normalize_audio=True, volume=1.0)
        with wave.open(str(temp_path), "wb") as wav_file:
            model.synthesize_wav(normalised, wav_file, syn_config=config)
        temp_path.replace(out_path)

        duration = wav_duration(out_path)
        synth_sec = round(time.time() - started, 2)
        prune_cache()
        return {
            "ok": True,
            "cached": False,
            "voice": voice["id"],
            "language": language,
            "file": out_name,
            "url": f"/tts-cache/{out_name}",
            "durationSec": duration,
            "synthSec": synth_sec,
            "sampleRate": voice["sampleRate"],
            "text": normalised,
        }


def wav_duration(path: Path) -> float:
    try:
        with wave.open(str(path), "rb") as wav_file:
            frames = wav_file.getnframes()
            rate = wav_file.getframerate() or 22050
            return round(frames / float(rate), 2)
    except Exception:  # noqa: BLE001
        return 0.0


def prune_cache(max_files: int = 1200) -> None:
    try:
        files = sorted(CACHE_DIR.glob("*.wav"), key=lambda p: p.stat().st_mtime, reverse=True)
        for stale in files[max_files:]:
            stale.unlink(missing_ok=True)
    except Exception:  # noqa: BLE001
        pass


def self_test(engine: PiperEngine) -> int:
    english = "Welcome to Christian Prayer Live. Faith, hope and love."
    vietnamese = "Xin chào quý vị. Chúng ta hãy cùng nhau cầu nguyện."
    failures = 0
    for language, text in (("en", english), ("vi", vietnamese)):
        result = engine.synthesize(text, language, "auto", 1.0)
        if result.get("ok"):
            print(f"{language.upper()} OK  voice={result['voice']}  {result['durationSec']}s -> {result['url']}")
        else:
            failures += 1
            print(f"{language.upper()} FAILED: {result.get('error')}")
    return 1 if failures else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Christian Prayer Live Piper worker")
    parser.add_argument("--self-test", action="store_true", help="synthesise one English and one Vietnamese sample and exit")
    args = parser.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

    emit({"type": "status", "status": "loading", "engine": "piper"})
    try:
        engine = PiperEngine()
    except Exception as exc:  # noqa: BLE001
        emit({"type": "error", "fatal": True, "error": str(exc), "trace": traceback.format_exc()})
        sys.exit(1)

    if args.self_test:
        sys.exit(self_test(engine))

    if not engine.voices:
        emit(
            {
                "type": "error",
                "fatal": True,
                "error": "No Piper voices found in config/piper/en or config/piper/vn",
            }
        )
        sys.exit(1)

    started = time.time()
    load_error = None
    if engine.default_en:
        try:
            engine.load_voice(engine.by_id[engine.default_en])
        except Exception as exc:  # noqa: BLE001
            load_error = f"{type(exc).__name__}: {exc}"
            log(f"failed to warm English voice: {load_error}")

    emit(
        {
            "type": "ready",
            "engine": "piper",
            "model": "Piper (local ONNX)",
            "voices": engine.voices,
            "defaults": {"en": engine.default_en, "vi": engine.default_vi},
            "loadSec": round(time.time() - started, 2),
            "loadError": load_error,
            "cacheDir": str(CACHE_DIR),
        }
    )

    prune_cache()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            text = (req.get("text") or "").strip()
            lang = (req.get("lang") or "auto").lower()
            voice = (req.get("voice") or "auto").strip()
            rate = float(req.get("rate") or 1.0)
            result = engine.synthesize(text, lang, voice, rate)
            emit({"type": "result", "id": req_id, **result})
        except Exception as exc:  # noqa: BLE001
            emit(
                {
                    "type": "result",
                    "id": req_id,
                    "ok": False,
                    "error": str(exc),
                }
            )


if __name__ == "__main__":
    main()
