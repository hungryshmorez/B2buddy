"""Tests for the AI DJ service against the real vendored modules. Run: python -m unittest services/aidj/test_service.py  (from the repo root)"""
import hashlib
import io
import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import core  # noqa: E402
import server  # noqa: E402

GOLDEN = os.path.join(HERE, "..", "..", "src", "game", "test", "fixtures", "aidj-golden.json")


def click_track_wav(bpm=120.0, seconds=24.0, sr=22050):
    """Kick-like bursts on every beat, so the true tempo is known by construction."""
    n = int(seconds * sr); y = np.zeros(n, dtype=np.float64); beat = 60.0 / bpm
    t = np.arange(int(0.12 * sr)) / sr; kick = np.sin(2 * np.pi * (60 + 90 * np.exp(-t * 40)) * t) * np.exp(-t * 25)
    k = 0
    while k * beat < seconds - 0.2:
        i = int(k * beat * sr); y[i:i + len(kick)] += kick[: n - i]; k += 1
    pcm = (np.clip(y, -1, 1) * 32000).astype("<i2")
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())
    return b.getvalue()


def tonal_wav(bpm=120.0, seconds=30.0, sr=22050, minor=True):
    """A bass note, a held triad and a kick on every beat: A minor (A C E) or C major (C E G), so the true key is known by construction."""
    n = int(seconds * sr); t = np.arange(n) / sr; beat = 60.0 / bpm
    notes = (55.0, [220.0, 261.63, 329.63]) if minor else (65.41, [261.63, 329.63, 392.0])
    y = 0.35 * np.sin(2 * np.pi * notes[0] * t) + sum(0.12 * np.sin(2 * np.pi * f * t) for f in notes[1])
    kt = np.arange(int(0.12 * sr)) / sr; kick = np.sin(2 * np.pi * (60 + 90 * np.exp(-kt * 40)) * kt) * np.exp(-kt * 25) * 0.6
    k = 0
    while k * beat < seconds - 0.2:
        i = int(k * beat * sr); y[i:i + len(kick)] += kick[: n - i]; k += 1
    pcm = (np.clip(y, -1, 1) * 30000).astype("<i2"); b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())
    return b.getvalue()


class ServiceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = server.make_server(0); cls.port = cls.srv.server_address[1]
        cls.th = threading.Thread(target=cls.srv.serve_forever, daemon=True); cls.th.start()
        cls.base = f"http://127.0.0.1:{cls.port}"
        with open(GOLDEN) as f:
            cls.golden = json.load(f)

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown(); cls.srv.server_close()

    def call(self, path, body=None, raw=None, headers=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, headers=headers or {"Content-Type": "application/json"}, method="POST" if data is not None else "GET")
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.loads(r.read()), dict(r.headers)
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}"), dict(e.headers)

    def test_vendored_files_are_the_fork_unmodified(self):
        with open(os.path.join(HERE, "vendor", "SHA256SUMS")) as f:
            for line in f:
                digest, name = line.split()
                with open(os.path.join(HERE, "vendor", name), "rb") as g:
                    self.assertEqual(hashlib.sha256(g.read()).hexdigest(), digest, name)

    def test_health_reports_runtime_and_limits(self):
        s, h, _ = self.call("/v1/health")
        self.assertEqual(s, 200); self.assertTrue(h["ok"]); self.assertEqual(h["fork"]["commit"], core.FORK_COMMIT)
        self.assertEqual(h["capabilities"], {"analyze": True, "analyzeLocal": True, "plan": True, "rank": True, "structureGpt": False}); self.assertFalse(h["openai"]["keyConfigured"] and h["openai"]["used"]); self.assertFalse(h["openai"]["used"]); self.assertTrue(h["librosa"])

    def test_plan_matches_golden_from_the_forks_functions(self):
        for case in self.golden["plan"][:40]:
            s, r, _ = self.call("/v1/plan", {"current": case["current"], "next": case["next"]})
            self.assertEqual(s, 200); self.assertEqual(r, case["result"])

    def test_rank_matches_golden_and_honours_avoid(self):
        for case in self.golden["rank"][:15]:
            s, r, _ = self.call("/v1/rank", {"previous": case["previous"], "candidates": case["candidates"], "avoid": case["avoid"]})
            self.assertEqual(s, 200); self.assertEqual(r["ranking"], case["result"]); self.assertTrue(all(x["id"] not in case["avoid"] for x in r["ranking"]))

    def test_camelot_codes_are_understood(self):
        a = {"id": "a", "bpm": 124, "key": "8A"}; b = {"id": "b", "bpm": 126, "key": "9A"}; c = {"id": "c", "bpm": 126, "key": "2B"}
        self.assertEqual(self.call("/v1/plan", {"current": a, "next": b})[1]["keyScore"], 1.0)        # Am -> Em
        self.assertEqual(self.call("/v1/plan", {"current": a, "next": c})[1]["keyScore"], -1.0)       # Am -> F#

    def test_analyze_measures_a_real_wav(self):
        s, r, _ = self.call("/v1/analyze", raw=click_track_wav(120.0), headers={"Content-Type": "audio/wav", "X-Track-Id": "click120"})
        self.assertEqual(s, 200); self.assertEqual(r["origin"], "measured"); self.assertEqual(r["trackId"], "click120")
        self.assertAlmostEqual(r["bpmBeatTrack"], 120.0, delta=3.0); self.assertGreater(r["beatCount"], 30); self.assertIn("NOT measured", r["note"])
        s, r2, _ = self.call("/v1/analyze", raw=click_track_wav(100.0), headers={"Content-Type": "audio/wav"})
        self.assertAlmostEqual(r2["bpmBeatTrack"], 100.0, delta=3.0)                                   # a different input gives a different measurement

    def test_local_engine_analyses_real_audio_and_labels_the_key_an_estimate(self):
        wav = tonal_wav(120.0)
        s, r, _ = self.call("/v1/analyze", raw=wav, headers={"Content-Type": "audio/wav"})
        self.assertEqual(s, 200); self.assertIsNone(r["localError"]); L = r["local"]
        self.assertEqual(L["origin"], "measured"); self.assertRegex(L["key"], r"^[A-G]#?m?$"); self.assertEqual(L["keyOrigin"], "estimated"); self.assertIn("RELATIVE", L["keyNote"])
        self.assertAlmostEqual(L["bpm"], 120.0, delta=3.0); self.assertGreater(L["beatCount"], 30); self.assertGreaterEqual(len(L["downbeatsSec"]), 10); self.assertAlmostEqual(L["downbeatsSec"][1] - L["downbeatsSec"][0], 4 * 60.0 / L["bpm"], delta=0.15)   # one bar apart
        self.assertFalse(L["vocals"]["reliable"]); self.assertIn("not song sections", L["segments"]["note"])
        for c in L["choruses"]:
            self.assertLess(c["start"], c["end"])

    def test_fork_key_estimator_is_right_or_the_relative_key_never_anything_else(self):
        """Pins the verified failure mode of the fork's estimate_key (scale chosen at root C only): on ideal Krumhansl-Kessler inputs it returns the true key
        or its relative major/minor, never an unrelated key. If the fork ever fixes it, this still passes and keyNote can be softened."""
        names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
        major = np.array([6.35, 2.26, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]); minor = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
        wrong = 0
        for k in range(12):
            for scale, prof in (("major", major), ("minor", minor)):
                got = core.tae.estimate_key(np.roll(prof, k).copy()); want = (names[k], scale)
                rel = (names[(k + 9) % 12], "minor") if scale == "major" else (names[(k + 3) % 12], "major")
                self.assertIn(got, (want, rel), f"{want} -> {got}")
                wrong += got != want
        print(f"[fork key estimator] relative-key answers on 24 ideal inputs: {wrong}")

    def test_invented_fallback_choruses_are_discarded_not_reported(self):
        real = core.tae._detect_choruses
        core.tae._detect_choruses = lambda y, sr, seg: [{"start": 10.0, "end": 20.0, "label": "Chorus (Mid-Track Fallback)"}]
        try:
            s, r, _ = self.call("/v1/analyze", raw=tonal_wav(120.0), headers={"Content-Type": "audio/wav"})
        finally:
            core.tae._detect_choruses = real
        self.assertEqual(r["local"]["choruses"], []); self.assertTrue(r["local"]["chorusFallbackDiscarded"])

    def test_local_engine_failure_is_reported_not_faked(self):
        real = core.tae.estimate_key
        def boom(_c):
            raise RuntimeError("key engine broke")
        core.tae.estimate_key = boom
        try:
            s, r, _ = self.call("/v1/analyze", raw=tonal_wav(120.0), headers={"Content-Type": "audio/wav"})
        finally:
            core.tae.estimate_key = real
        self.assertEqual(s, 500)                                                                           # never a made-up "key: C, bpm: 120" fallback

    def test_silence_is_not_reported_as_a_measurement(self):
        b = io.BytesIO()
        with wave.open(b, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050); w.writeframes(b"\x00\x00" * 22050 * 6)
        s, r, _ = self.call("/v1/analyze", raw=b.getvalue(), headers={"Content-Type": "audio/wav"})
        self.assertEqual(s, 422); self.assertIn("nothing was measured", r["error"])

    def test_bad_input_is_rejected_and_the_service_survives(self):
        self.assertEqual(self.call("/v1/analyze", raw=b"not a wav at all, definitely not riff", headers={"Content-Type": "audio/wav"})[0], 400)
        self.assertEqual(self.call("/v1/plan", raw=b"{broken json", headers={"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.call("/v1/nope", {})[0], 404)
        self.assertEqual(self.call("/v1/plan", {"current": {"id": "x"}, "next": {"id": "y"}})[0], 200)  # defaults, no crash
        self.assertEqual(self.call("/v1/health")[0], 200)

    def test_cors_allows_localhost_and_refuses_foreign_origins(self):
        s, _, h = self.call("/v1/health", headers={"Origin": "http://localhost:5173"}); self.assertEqual(h.get("Access-Control-Allow-Origin"), "http://localhost:5173")
        s, _, h = self.call("/v1/plan", {"current": {}, "next": {}}, headers={"Origin": "https://evil.example", "Content-Type": "application/json"}); self.assertEqual(s, 403)


if __name__ == "__main__":
    unittest.main()
