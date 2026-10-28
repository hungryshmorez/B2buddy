"""B2Buddy adapter around the REAL AI DJ modules (vendored unmodified in ./vendor).

Everything that decides something here is a call into the fork's own code:
  generate_mixing_plan.score_transition_candidate / select_best_transition_point / calculate_dynamic_overlap / calculate_key_compatibility
  structure_detector.extract_beat_times_fast / analyze_energy_curve      (local librosa analysis)
  bpm_lookup.estimate_bpm_with_librosa                                   (local librosa analysis)
This file only (a) converts B2Buddy's Camelot codes to the note names the fork uses, (b) normalises inputs, (c) silences the fork's print()s,
(d) assembles the response. It never calls OpenAI: the fork's Whisper/GPT-4o structure stage is not used.
"""
import contextlib
import io
import os
import sys
import tempfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "vendor"))
DATA_DIR = os.environ.get("AIDJ_DATA_DIR") or os.path.join(tempfile.gettempdir(), "b2buddy-aidj")
os.makedirs(DATA_DIR, exist_ok=True)

_cwd = os.getcwd()
os.chdir(DATA_DIR)                      # the fork creates ./notes (a cache we do not use) at import time; keep it out of the source tree
try:
    with contextlib.redirect_stdout(io.StringIO()):
        import generate_mixing_plan as gmp
        import structure_detector as sd
        import bpm_lookup as bl
finally:
    os.chdir(_cwd)

import librosa  # noqa: E402  (already imported by the vendored modules)

# ---- the fork's OLDER, fully local analysis engine (older_way/track_analysis_engine.py), vendored unmodified ----
# It imports tensorflow at module top but only uses it if a ./downbeat_model.h5 file exists (none does), so when tensorflow is not installed a stub
# is registered purely so the import succeeds. If anything else about the import fails, local analysis is reported unavailable (never faked).
LOCAL_ERROR = None
TF_STUBBED = False
try:
    sys.path.insert(0, os.path.join(HERE, "vendor", "older_way"))
    try:
        import tensorflow  # noqa: F401
    except Exception:
        import types
        _tf = types.ModuleType("tensorflow")

        def _no_model(*_a, **_k):
            raise RuntimeError("tensorflow is not installed")

        _tf.keras = types.SimpleNamespace(models=types.SimpleNamespace(load_model=_no_model))
        sys.modules["tensorflow"] = _tf
        TF_STUBBED = True
    os.chdir(DATA_DIR)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            import track_analysis_engine as tae
    finally:
        os.chdir(_cwd)
except Exception as _e:  # noqa: BLE001
    tae = None
    LOCAL_ERROR = f"{type(_e).__name__}: {_e}"

# Compatibility shim (the vendored files stay unmodified). The fork pins librosa==0.9.2 / numpy 1.26, where beat_track returns a scalar tempo.
# Current librosa returns a 1-element array, which makes the fork's own `round(tempo)` and beat code raise and silently fall back to defaults.
_orig_beat_track = librosa.beat.beat_track


def _beat_track_scalar_tempo(*args, **kwargs):
    tempo, beats = _orig_beat_track(*args, **kwargs)
    try:
        import numpy as _np
        if isinstance(tempo, _np.ndarray) and tempo.size == 1:
            tempo = float(tempo.reshape(-1)[0])
    except Exception:
        pass
    return tempo, beats


librosa.beat.beat_track = _beat_track_scalar_tempo

FORK_COMMIT = "d56bd28c772f713ae39fc9ac33d0b555b98e1ce4"
FORK_REPO = "hungryshmorez/AI-DJ-Mixing-System"

# Camelot code -> the note-name key the fork's CAMELOT_WHEEL uses (A = minor, B = major)
CAMELOT_TO_KEY = {
    "1A": "G#m", "2A": "D#m", "3A": "A#m", "4A": "Fm", "5A": "Cm", "6A": "Gm", "7A": "Dm", "8A": "Am", "9A": "Em", "10A": "Bm", "11A": "F#m", "12A": "C#m",
    "1B": "B", "2B": "F#", "3B": "C#", "4B": "G#", "5B": "D#", "6B": "A#", "7B": "F", "8B": "C", "9B": "G", "10B": "D", "11B": "A", "12B": "E",
}


def quiet(fn, *args):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*args)


def to_aidj_key(k):
    """Camelot code or note name -> the fork's note name; unknown -> '' (the fork then treats it as neutral)."""
    if not isinstance(k, str):
        return ""
    k = k.strip()
    if k.upper() in CAMELOT_TO_KEY:
        return CAMELOT_TO_KEY[k.upper()]
    return k if k in gmp.CAMELOT_WHEEL else ""


def norm_track(t):
    """The dict shape the fork's functions read. Missing structure stays missing: the fork's own defaults apply."""
    t = t or {}
    out = {
        "id": str(t.get("id", "")),
        "title": str(t.get("title", "")),
        "bpm": float(t["bpm"]) if isinstance(t.get("bpm"), (int, float)) else 120.0,
        "key": to_aidj_key(t.get("key")),
        "genre": str(t.get("genre") or "").lower(),
    }
    if isinstance(t.get("structure"), dict):
        out["structure"] = t["structure"]
    return out


def plan_transition(current, nxt):
    """Run the fork's transition decision for current -> next. Returns every candidate with the fork's own score."""
    c, n = norm_track(current), norm_track(nxt)
    structure = c.get("structure", c)
    cands = structure.get("transition_candidates", [])
    scored = []
    for cand in cands:
        s = quiet(gmp.score_transition_candidate, cand, c, n)
        scored.append({"time": cand["time"], "type": cand["type"], "score": s, "reasoning": cand.get("reasoning", "")})
    scored.sort(key=lambda x: x["score"], reverse=True)     # same ordering call as select_best_transition_point (stable)
    chosen_time = quiet(gmp.select_best_transition_point, c, n)   # the fork's own selection is authoritative
    best = scored[0] if scored else None
    if best is not None and best["time"] != chosen_time:
        raise RuntimeError("adapter disagrees with the fork's selection")
    return {
        "transitionTimeSec": chosen_time,
        "best": best,
        "candidates": scored,
        "overlapSec": quiet(gmp.calculate_dynamic_overlap, c, n),
        "keyScore": gmp.calculate_key_compatibility(c["key"], n["key"]),
        "bpmDiff": abs(c["bpm"] - n["bpm"]),
    }


def rank_next(previous, candidates, avoid=()):
    """Rank candidate next tracks by the fork's best transition score from `previous`. Ties: smaller BPM gap, then input order."""
    rows = []
    for i, cand in enumerate(candidates):
        cid = str((cand or {}).get("id", ""))
        if cid in avoid or cid == str((previous or {}).get("id", "")):
            continue
        p = plan_transition(previous, cand)
        rows.append({"id": cid, "score": p["best"]["score"] if p["best"] else 50.0, "keyScore": p["keyScore"], "bpmDiff": p["bpmDiff"], "overlapSec": p["overlapSec"],
                     "bestType": p["best"]["type"] if p["best"] else None, "bestTime": p["transitionTimeSec"], "_i": i})
    rows.sort(key=lambda r: (-r["score"], r["bpmDiff"], r["_i"]))
    for r in rows:
        del r["_i"]
    return rows


class AnalysisError(Exception):
    pass


def analysis_ready():
    """False when the fork has silently disabled its own librosa code (see requirements.txt: structure_detector imports openai and librosa in one try-block)."""
    return getattr(sd, "librosa", None) is not None and getattr(bl, "librosa", None) is not None


def analyze_wav(path):
    if not analysis_ready():
        raise AnalysisError("the fork's structure_detector disabled librosa: install the 'openai' package (no API key needed); see services/aidj/README.md")
    """Measured analysis of one audio file by the fork's librosa code. Everything here is measured, none of it is looked up or guessed."""
    est = quiet(bl.estimate_bpm_with_librosa, path)                         # {'bpm': int, 'energy': 0..1} or None
    beats, tempo, phrases = quiet(sd.extract_beat_times_fast, path, 90)     # beat times, tempo, 8-bar phrase boundaries
    energy = quiet(sd.analyze_energy_curve, path, 120)
    if est is None or len(beats) == 0:
        # the fork's functions swallow their own errors and return defaults (e.g. a constant 120 BPM): never report that as a measurement
        raise AnalysisError("beat tracking produced no result; nothing was measured")
    t = float(tempo[0]) if hasattr(tempo, "__len__") and len(tempo) else float(tempo)
    local = None
    local_error = None
    if local_ready():
        try:
            local = analyze_local(path)
        except AnalysisError as e:
            local_error = str(e)
    else:
        local_error = "older_way local analysis unavailable: " + str(LOCAL_ERROR)
    return {
        "local": local,
        "localError": local_error,
        "origin": "measured",
        "engine": "librosa " + librosa.__version__,
        "bpmBeatTrack": round(t, 2),
        "bpmRounded": est["bpm"],
        "energy": est["energy"],
        "beatCount": int(len(beats)),
        "firstBeatSec": float(beats[0]) if len(beats) else None,
        "phraseBoundariesSec": [float(x) for x in phrases],
        "energyAnalysis": {k: energy[k] for k in ("has_buildup", "has_drop", "buildups", "drops") if k in energy},
        "note": "genre is NOT measured (the fork looks it up with OpenAI, which this service never calls). Key, choruses and a weak vocal guess come from the fork's older local engine under `local`.",
    }


MAX_LOCAL_SEC = 240


def local_ready():
    return tae is not None


def analyze_local(path):
    """Measured analysis by the fork's older local engine's own helper functions (no OpenAI, no Gemini).
    The fork's analyze_track() is deliberately NOT used: it asks Gemini for the BPM and, on any failure, returns an invented fallback dict
    (bpm 120, key C). Here every failure raises instead."""
    if tae is None:
        raise AnalysisError("older_way local analysis unavailable: " + str(LOCAL_ERROR))
    y, sr = librosa.load(path, sr=22050, duration=MAX_LOCAL_SEC)
    if len(y) < 3 * sr:
        raise AnalysisError("audio shorter than 3 seconds")
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, tightness=100)
    if len(beats) < 4:
        raise AnalysisError("fewer than 4 beats found; nothing was measured")
    beat_times = librosa.frames_to_time(beats, sr=sr)
    downbeats = quiet(tae._detect_downbeats, y, sr, beats)
    chroma_mean = np.mean(tae.chroma_stft(y=y, sr=sr), axis=1)
    key, scale = tae.estimate_key(chroma_mean)
    segments = quiet(tae._structural_segmentation, y, sr, beats)
    found = quiet(tae._detect_choruses, y, sr, segments)
    real = [c for c in found if c.get("label") == "Chorus"]           # the fork's fallbacks invent a chorus (mid-track / longest segment): discard those
    vocals = bool(quiet(tae._detect_vocals, y, sr))
    t = float(tempo[0]) if hasattr(tempo, "__len__") and len(tempo) else float(tempo)
    return {
        "origin": "measured",
        "engine": "older_way/track_analysis_engine (fork " + FORK_COMMIT[:7] + "), librosa " + librosa.__version__,
        "durationSec": round(len(y) / sr, 2),
        "bpm": round(t, 2),
        "beatCount": int(len(beats)),
        "firstBeatSec": round(float(beat_times[0]), 3),
        "downbeatsSec": [round(float(x), 3) for x in downbeats[:16]],
        "key": key + ("m" if scale == "minor" else ""),
        "keyScale": scale,
        "keyMethod": "Krumhansl-Kessler profile correlation on mean chroma",
        "keyOrigin": "estimated",
        "keyNote": "an ESTIMATE: the fork decides major vs minor at root C only, so for about half of ideal inputs it returns the RELATIVE key (A minor comes back as C major). Relative keys mix compatibly, but the label can be wrong.",
        "energy": round(float(np.mean(tae.rms(y=y))), 4),
        "choruses": [{"start": round(float(c["start"]), 2), "end": round(float(c["end"]), 2)} for c in real],
        "chorusMethod": "chroma self-recurrence (repetition-based results only)",
        "chorusFallbackDiscarded": len(real) == 0 and len(found) > 0,
        "segments": {"count": len(segments), "note": "per-beat High/Low energy runs, not song sections; not used for decisions"},
        "vocals": {"heuristic": vocals, "reliable": False, "note": "mean 200-4000 Hz energy > 0.01: a weak guess; never used in scoring"},
    }


def openai_status():
    key = bool(os.environ.get("OPENAI_API_KEY"))
    pkg = getattr(sd, "OpenAI", None) is not None
    return {"package": pkg, "keyConfigured": key, "used": False}
