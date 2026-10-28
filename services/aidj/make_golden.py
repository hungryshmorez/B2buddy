#!/usr/bin/env python3
"""Generate golden vectors by running the fork's REAL functions (through core.py). The TypeScript port is tested against this file.
   python services/aidj/make_golden.py > src/game/test/fixtures/aidj-golden.json
"""
import json
import random
import sys

import core

gmp = core.gmp
rnd = random.Random(20261028)
KEYS = list(gmp.CAMELOT_WHEEL.keys())
GENRES = ["", "afrobeats", "r&b", "pop", "edm", "hip hop", "dancehall", "House", "Rap", "techno", "EDM"]
TYPES = ["verse_end", "chorus_end", "breakdown_start", "pre_drop", "mid_chorus", "mid_vocal_phrase", "mid_buildup", "mid_hook", "phrase_end"]
ENERGIES = ["high", "building", "dropping", "medium", None]


def make_track(i):
    t = {"id": f"t{i}", "title": f"Track {i}", "bpm": round(rnd.uniform(70, 175), 1), "key": rnd.choice(KEYS + list(core.CAMELOT_TO_KEY.keys()) + ["", "H#"]), "genre": rnd.choice(GENRES)}
    if rnd.random() < 0.85:
        cands = []
        for _ in range(rnd.randint(0, 5)):
            c = {"time": round(rnd.uniform(30, 150), 1), "type": rnd.choice(TYPES), "reasoning": "r"}
            if rnd.random() < 0.8:
                c["has_vocals_after"] = rnd.random() < 0.5
            e = rnd.choice(ENERGIES)
            if e:
                c["energy"] = e
            cands.append(c)
        s = {"transition_candidates": cands}
        if rnd.random() < 0.5:
            s["has_vocals_in_first_8s"] = rnd.random() < 0.5
        if rnd.random() < 0.5:
            s["energy_analysis"] = {"buildups": [{"time": 50}] * rnd.randint(0, 2)}
        if not cands and rnd.random() < 0.5:
            s["recommended_transition"] = round(rnd.uniform(40, 100), 1)
        if not cands and rnd.random() < 0.5:
            s["transition_point"] = round(rnd.uniform(40, 100), 1)
        t["structure"] = s
    return t


tracks = [make_track(i) for i in range(60)]
out = {"fork": core.FORK_COMMIT, "keyCompat": [], "overlap": [], "plan": [], "rank": [], "keyMap": core.CAMELOT_TO_KEY}
for a in KEYS + [""]:
    for b in KEYS + [""]:
        out["keyCompat"].append([a, b, gmp.calculate_key_compatibility(a, b)])
for _ in range(300):
    a, b = rnd.choice(tracks), rnd.choice(tracks)
    n = core.norm_track
    out["overlap"].append({"a": a, "b": b, "overlapSec": core.quiet(gmp.calculate_dynamic_overlap, n(a), n(b))})
    out["plan"].append({"current": a, "next": b, "result": core.plan_transition(a, b)})
for _ in range(60):
    prev = rnd.choice(tracks)
    cands = rnd.sample(tracks, 6)
    avoid = [rnd.choice(cands)["id"]] if rnd.random() < 0.5 else []
    out["rank"].append({"previous": prev, "candidates": cands, "avoid": avoid, "result": core.rank_next(prev, cands, set(avoid))})
json.dump(out, sys.stdout, separators=(",", ":"))
