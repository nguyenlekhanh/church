#!/usr/bin/env python3
"""Generate original ambient worship instrumentals for Christian Prayer Live.

Everything here is synthesised from scratch (sine/triangle partials, filtered
noise reverb) - there are no samples, no third-party recordings and therefore
no licensing obligations.  Each track is rendered on a circular timeline and
reverbed with circular convolution, so the first and last sample join without
a click or a silent gap.  That makes the files safe for a hard `loop` in OBS.

Usage:
    .venv/Scripts/python.exe scripts/generate_music.py            # render all
    .venv/Scripts/python.exe scripts/generate_music.py --track piano-worship-01

Output: public/assets/christian/audio/*.ogg plus music-manifest.json
Requires: numpy, ffmpeg on PATH.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "assets" / "christian" / "audio"
SR = 44100
RNG = np.random.default_rng(20261031)

PITCH = {"C": 0, "C#": 1, "Db": 1, "D": 2, "Eb": 3, "E": 4, "F": 5, "F#": 6,
         "G": 7, "G#": 8, "Ab": 8, "A": 9, "Bb": 10, "B": 11}


def note_freq(name: str) -> float:
    """'D3' -> 146.83 Hz."""
    letter = name[:-1]
    octave = int(name[-1])
    midi = 12 * (octave + 1) + PITCH[letter]
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))


def add_circular(buf: np.ndarray, start: int, samples: np.ndarray) -> None:
    """Mix a mono/stereo event into a circular buffer, wrapping the tail."""
    n = buf.shape[0]
    start %= n
    length = samples.shape[0]
    if length == 0:
        return
    # Anything longer than the loop is folded in pieces.
    offset = 0
    while offset < length:
        chunk = min(n, length - offset)
        pos = (start + offset) % n
        piece = samples[offset:offset + chunk]
        end = pos + chunk
        if end <= n:
            if buf.ndim == 1:
                buf[pos:end] += piece
            else:
                buf[pos:end] += piece
        else:
            split = n - pos
            if buf.ndim == 1:
                buf[pos:] += piece[:split]
                buf[:end - n] += piece[split:]
            else:
                buf[pos:] += piece[:split]
                buf[:end - n] += piece[split:]
        offset += chunk


def stereo(mono: np.ndarray, pan: float) -> np.ndarray:
    """pan -1..1 (negative = left)."""
    left = math.sqrt((1.0 - pan) / 2.0)
    right = math.sqrt((1.0 + pan) / 2.0)
    return np.stack([mono * left * 1.4142, mono * right * 1.4142], axis=1)


def pad(freq: float, duration: float, amp: float, attack: float, release: float,
        detune: float = 0.0, brightness: float = 0.55) -> np.ndarray:
    """Slow, warm sustained tone with soft harmonics and a breathing LFO."""
    n = int(duration * SR)
    t = np.arange(n) / SR
    env = np.ones(n)
    a = min(n, int(attack * SR))
    r = min(n, int(release * SR))
    if a:
        env[:a] = 0.5 - 0.5 * np.cos(np.linspace(0, math.pi, a))
    if r:
        env[-r:] *= 0.5 + 0.5 * np.cos(np.linspace(0, math.pi, r))
    lfo = 1.0 + 0.06 * np.sin(2 * math.pi * 0.07 * t + freq * 0.01)

    signal = np.zeros(n)
    partials = [(1.0, 1.0), (2.0, 0.34), (3.0, 0.17), (4.0, 0.09), (5.0, 0.05), (6.0, 0.025)]
    for ratio, level in partials:
        weight = level * math.exp(-ratio * (1.0 - brightness) * 1.4)
        for shift in (-detune, detune):
            f = freq * ratio * (1.0 + shift)
            signal += weight * np.sin(2 * math.pi * f * t + RNG.random() * 6.283)
    signal *= env * lfo
    peak = np.max(np.abs(signal)) or 1.0
    return stereo(signal / peak * amp, 0.0)


def piano(freq: float, duration: float, amp: float) -> np.ndarray:
    """Soft felt-piano voice: inharmonic partials, fast attack, long decay."""
    n = int(duration * SR)
    t = np.arange(n) / SR
    attack = np.exp(-t / 0.012)
    decay = np.exp(-t / (duration * 0.42))
    signal = np.zeros(n)
    partials = [(1.0, 1.0, 1.0), (2.01, 0.42, 0.72), (3.02, 0.19, 0.5),
                (4.04, 0.09, 0.36), (5.07, 0.045, 0.26), (6.1, 0.022, 0.2)]
    for ratio, level, keep in partials:
        signal += level * np.exp(-t / (duration * 0.42 * keep)) * np.sin(
            2 * math.pi * freq * ratio * t)
    signal *= (1.0 - np.exp(-t / 0.004)) * decay + attack * 0.15
    signal /= max(np.max(np.abs(signal)), 1e-9)
    return stereo(signal * amp, RNG.uniform(-0.22, 0.22))


def strings(freq: float, duration: float, amp: float) -> np.ndarray:
    """Soft ensemble string: band-limited saw, slow swell, gentle vibrato."""
    n = int(duration * SR)
    t = np.arange(n) / SR
    vib = 1.0 + 0.0032 * np.sin(2 * math.pi * 4.6 * t)
    signal = np.zeros(n)
    for harmonic in range(1, 11):
        f = freq * harmonic * vib
        signal += (1.0 / harmonic ** 1.45) * np.sin(2 * math.pi * f * t + harmonic * 0.7)
    env = 0.5 - 0.5 * np.cos(np.linspace(0, math.pi, min(n, int(1.6 * SR))))
    envelope = np.ones(n)
    envelope[:len(env)] = env
    tail = min(n, int(2.2 * SR))
    envelope[-tail:] *= 0.5 + 0.5 * np.cos(np.linspace(0, math.pi, tail))
    signal *= envelope
    signal /= max(np.max(np.abs(signal)), 1e-9)
    return stereo(signal * amp, 0.0)


def make_ir(seconds: float, damp: float) -> np.ndarray:
    """Exponentially decaying noise impulse response for a cathedral tail."""
    n = int(seconds * SR)
    t = np.arange(n) / SR
    noise = RNG.standard_normal(n)
    # One-pole lowpass so the tail darkens as it decays.
    alpha = damp
    smooth = np.zeros(n)
    acc = 0.0
    for i in range(0, n):
        acc += alpha * (noise[i] - acc)
        smooth[i] = acc
    env = np.exp(-t * 2.1) * (1.0 - np.exp(-t * 40.0))
    return smooth * env


def circular_reverb(buf: np.ndarray, ir: np.ndarray, wet: float) -> np.ndarray:
    n = buf.shape[0]
    padded = np.zeros(n)
    padded[:min(len(ir), n)] = ir[:min(len(ir), n)]
    spec = np.fft.rfft(padded)
    out = np.empty_like(buf)
    for ch in range(buf.shape[1]):
        wet_signal = np.fft.irfft(np.fft.rfft(buf[:, ch]) * spec, n)
        out[:, ch] = buf[:, ch] * (1.0 - wet * 0.55) + wet_signal * wet * 0.42
    return out


def render_track(spec: dict) -> tuple[np.ndarray, dict]:
    bpm = spec["bpm"]
    bars = spec["bars"]
    bar = 4.0 * 60.0 / bpm
    total = int(round(bars * bar * SR))
    buf = np.zeros((total, 2), dtype=np.float64)
    progression = spec["chords"]

    for b in range(bars):
        chord = progression[b % len(progression)]
        start = int(round(b * bar * SR))
        # Pads: one long swelling chord per bar.
        for name in (chord["pad"] if spec.get("pad", 0) > 0 else []):
            f = note_freq(name)
            note = pad(f, bar * 1.12, spec["pad"], attack=bar * 0.55,
                       release=bar * 0.7, detune=0.0012,
                       brightness=spec.get("brightness", 0.55))
            add_circular(buf, start, note)
        # Bass root, an octave under the pad, very quiet.
        if spec.get("bass", 0) > 0:
            root = chord["bass"][0]
            note = pad(note_freq(root), bar * 1.05, spec["bass"],
                       attack=bar * 0.3, release=bar * 0.6, brightness=0.3)
            add_circular(buf, start, note)
        # String bed.
        if spec.get("strings", 0) > 0 and b % 2 == 0:
            for name in chord["strings"]:
                note = strings(note_freq(name), bar * 2.05, spec["strings"])
                add_circular(buf, start, note)
        # Piano: sparse arpeggio with an occasional upper answer.
        if spec.get("piano", 0) > 0:
            pattern = spec["piano_pattern"]
            notes = chord["piano"]
            for step, (beat, index, level) in enumerate(pattern):
                if (b + step) % spec.get("piano_skip", 1) == 0 or step == 0:
                    name = notes[index % len(notes)]
                    offset = int(round((beat * 60.0 / bpm) * SR))
                    length = min(total, int((bar * 1.6) * SR))
                    note = piano(note_freq(name), length / SR,
                                 spec["piano"] * level)
                    add_circular(buf, start + offset, note)
        # A single high bell-like piano note every few bars for lift.
        if spec.get("lift", 0) > 0 and b % 4 == 2:
            name = chord["piano"][-1]
            f = note_freq(name) * 2.0
            note = piano(f, bar * 2.4, spec["lift"])
            add_circular(buf, start + int(bar * 0.5 * SR), note)

    buf = circular_reverb(buf, make_ir(spec.get("reverb", 2.8),
                                       spec.get("damp", 0.16)),
                          spec.get("wet", 0.4))
    # Gentle bus glue: soft-knee limiting keeps the loop from clipping.
    peak = np.max(np.abs(buf)) or 1.0
    buf = np.tanh(buf / peak * 1.15) / math.tanh(1.15) * 0.86
    metrics = {
        "durationSeconds": round(total / SR, 2),
        "sampleRate": SR,
        "channels": 2,
        "bpm": bpm,
        "bars": bars,
        "peak": round(float(np.max(np.abs(buf))), 4),
        "loopSeamDelta": round(float(np.max(np.abs(buf[0] - buf[-1]))), 6),
        "rms": round(float(np.sqrt(np.mean(buf ** 2))), 4),
    }
    return buf, metrics


def write_wav(path: Path, buf: np.ndarray) -> None:
    pcm = np.clip(buf, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(pcm.tobytes())


def encode(wav_path: Path, ogg_path: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg is required to encode the tracks (ogg/opus).")
    subprocess.run(
        [ffmpeg, "-y", "-loglevel", "error", "-i", str(wav_path),
         "-c:a", "libopus", "-b:a", "112k", "-vbr", "on",
         "-compression_level", "10", "-application", "audio",
         "-metadata", "artist=Christian Prayer Live",
         "-metadata", "album=Ambient Worship",
         str(ogg_path)],
        check=True,
    )


CHORDS = {
    "D": {"pad": ["D3", "F#3", "A3", "D4"], "bass": ["D2"],
          "strings": ["A3", "D4", "F#4"], "piano": ["D4", "F#4", "A4", "D5", "F#5"]},
    "A/C#": {"pad": ["C#3", "E3", "A3", "C#4"], "bass": ["C#2"],
             "strings": ["E4", "A4", "C#5"], "piano": ["C#4", "E4", "A4", "C#5", "E5"]},
    "Bm": {"pad": ["B2", "D3", "F#3", "B3"], "bass": ["B1"],
           "strings": ["F#3", "B3", "D4"], "piano": ["B3", "D4", "F#4", "B4", "D5"]},
    "G": {"pad": ["G2", "B2", "D3", "G3"], "bass": ["G1"],
          "strings": ["D3", "G3", "B3"], "piano": ["G3", "B3", "D4", "G4", "B4"]},
    "D/F#": {"pad": ["F#2", "A2", "D3", "F#3"], "bass": ["F#1"],
             "strings": ["A3", "D4", "F#4"], "piano": ["F#3", "A3", "D4", "F#4", "A4"]},
    "A": {"pad": ["A2", "C#3", "E3", "A3"], "bass": ["A1"],
          "strings": ["E3", "A3", "C#4"], "piano": ["A3", "C#4", "E4", "A4", "C#5"]},
    "Dm": {"pad": ["D3", "F3", "A3", "D4"], "bass": ["D2"],
           "strings": ["A3", "D4", "F4"], "piano": ["D4", "F4", "A4", "D5", "F5"]},
    "Em": {"pad": ["E2", "G2", "B2", "E3"], "bass": ["E1"],
           "strings": ["B3", "E4", "G4"], "piano": ["E3", "G3", "B3", "E4", "G4"]},
    "C": {"pad": ["C3", "E3", "G3", "C4"], "bass": ["C2"],
          "strings": ["G3", "C4", "E4"], "piano": ["C4", "E4", "G4", "C5", "E5"]},
    "Am": {"pad": ["A2", "C3", "E3", "A3"], "bass": ["A1"],
           "strings": ["E3", "A3", "C4"], "piano": ["A3", "C4", "E4", "A4", "C5"]},
    "F": {"pad": ["F2", "A2", "C3", "F3"], "bass": ["F1"],
          "strings": ["C3", "F3", "A3"], "piano": ["F3", "A3", "C4", "F4", "A4"]},
    "Bb": {"pad": ["Bb2", "D3", "F3", "Bb3"], "bass": ["Bb1"],
           "strings": ["F3", "Bb3", "D4"], "piano": ["Bb3", "D4", "F4", "Bb4", "D5"]},
    "E/G#": {"pad": ["G#2", "B2", "E3", "G#3"], "bass": ["G#1"],
             "strings": ["B3", "E4", "G#4"], "piano": ["G#3", "B3", "E4", "G#4", "B4"]},
    "F#m": {"pad": ["F#2", "A2", "C#3", "F#3"], "bass": ["F#1"],
            "strings": ["C#4", "F#4", "A4"], "piano": ["F#3", "A3", "C#4", "F#4", "A4"]},
}

TRACKS = {
    "peaceful-prayer-01": {
        "title": "Peaceful Prayer",
        "mood": "Warm pads, soft felt piano",
        "bpm": 60,
        "bars": 52,
        "chords": [CHORDS[n] for n in ("D", "A/C#", "Bm", "G", "D", "A/C#", "G", "A/C#")],
        "pad": 0.30, "bass": 0.10, "piano": 0.26, "strings": 0.0, "lift": 0.05,
        "piano_pattern": [(0.0, 0, 1.0), (1.5, 2, 0.7), (2.5, 1, 0.55), (3.25, 3, 0.5)],
        "piano_skip": 3,
        "reverb": 3.1, "wet": 0.44, "brightness": 0.5,
    },
    "peaceful-prayer-02": {
        "title": "Quiet Hour",
        "mood": "String ensemble over slow harmony",
        "bpm": 56,
        "bars": 44,
        "chords": [CHORDS[n] for n in ("G", "D/F#", "Em", "C", "G", "D/F#", "C", "D/F#")],
        "pad": 0.26, "bass": 0.08, "piano": 0.16, "strings": 0.11, "lift": 0.03,
        "piano_pattern": [(0.0, 0, 0.9), (2.0, 2, 0.55), (3.0, 4, 0.4)],
        "piano_skip": 2,
        "reverb": 3.4, "wet": 0.5, "brightness": 0.48,
    },
    "cathedral-ambient-01": {
        "title": "Cathedral Light",
        "mood": "Deep organ-like ambience, wide stone reverb",
        "bpm": 52,
        "bars": 42,
        "chords": [CHORDS[n] for n in ("C", "Am", "F", "G", "C", "Am", "F", "G")],
        "pad": 0.32, "bass": 0.12, "piano": 0.08, "strings": 0.10, "lift": 0.0,
        "piano_pattern": [(0.0, 0, 0.7), (2.5, 3, 0.4)],
        "piano_skip": 3,
        "reverb": 4.2, "wet": 0.62, "brightness": 0.42, "damp": 0.1,
    },
    "piano-worship-01": {
        "title": "Piano Worship",
        "mood": "Solo felt piano, gentle arpeggios",
        "bpm": 66,
        "bars": 56,
        "chords": [CHORDS[n] for n in ("F", "C", "Dm", "Bb", "F", "C", "Bb", "C")],
        "pad": 0.0, "bass": 0.09, "piano": 0.34, "strings": 0.0, "lift": 0.045,
        "piano_pattern": [(0.0, 0, 1.0), (1.0, 2, 0.6), (2.0, 1, 0.5), (3.0, 3, 0.58),
                          (3.5, 4, 0.34)],
        "piano_skip": 1,
        "reverb": 2.9, "wet": 0.42, "brightness": 0.55,
    },
    "morning-prayer-01": {
        "title": "Morning Prayer",
        "mood": "Bright piano with sunrise pads",
        "bpm": 72,
        "bars": 60,
        "chords": [CHORDS[n] for n in ("A", "E/G#", "F#m", "D", "A", "E/G#", "D", "E/G#")],
        "pad": 0.24, "bass": 0.09, "piano": 0.3, "strings": 0.07, "lift": 0.05,
        "piano_pattern": [(0.0, 0, 1.0), (1.0, 2, 0.62), (2.0, 4, 0.5), (3.0, 3, 0.58)],
        "piano_skip": 2,
        "reverb": 2.6, "wet": 0.38, "brightness": 0.6,
    },
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--track", action="append", help="render only these ids")
    args = parser.parse_args()

    if not shutil.which("ffmpeg"):
        print("ffmpeg not found on PATH", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT_DIR / "music-manifest.json"
    existing = {}
    if manifest_path.exists():
        try:
            existing = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            existing = {}
    by_id = {t["id"]: t for t in existing.get("tracks", [])}

    selected = args.track or list(TRACKS.keys())
    with tempfile.TemporaryDirectory() as temp:
        for track_id in selected:
            spec = TRACKS[track_id]
            print(f"[music] rendering {track_id} ({spec['bpm']} BPM, {spec['bars']} bars)")
            buf, metrics = render_track(spec)
            wav_path = Path(temp) / f"{track_id}.wav"
            write_wav(wav_path, buf)
            ogg_path = OUT_DIR / f"{track_id}.ogg"
            encode(wav_path, ogg_path)
            by_id[track_id] = {
                "id": track_id,
                "title": spec["title"],
                "file": ogg_path.name,
                "mood": spec["mood"],
                "bpm": metrics["bpm"],
                "durationSeconds": metrics["durationSeconds"],
                "format": "Ogg Opus 112 kb/s, 44.1 kHz stereo",
                "bytes": ogg_path.stat().st_size,
                "loop": "seamless (circular render + circular convolution reverb)",
                "license": "Original composition, dedicated to the public domain (CC0 1.0)",
                "source": "scripts/generate_music.py (synthesised locally, no samples)",
                "attribution": "None required",
                "metrics": {
                    "peak": metrics["peak"],
                    "rms": metrics["rms"],
                    "loopSeamDelta": metrics["loopSeamDelta"],
                },
            }
            print(f"[music]   {ogg_path.name}: {metrics['durationSeconds']}s, "
                  f"{ogg_path.stat().st_size / 1048576:.2f} MB, seam {metrics['loopSeamDelta']}")

    order = list(TRACKS.keys())
    tracks = [by_id[i] for i in order if i in by_id]
    manifest = {
        "description": "Original ambient worship instrumentals for Christian Prayer Live.",
        "generatedBy": "scripts/generate_music.py",
        "license": "CC0 1.0 (public domain dedication) - synthesised from scratch, no samples",
        "notes": "No vocals, no percussion. Each file loops seamlessly on a circular timeline.",
        "defaultVolume": 0.1,
        "duckedVolume": 0.035,
        "tracks": tracks,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"[music] wrote {manifest_path.relative_to(ROOT)} ({len(tracks)} tracks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
