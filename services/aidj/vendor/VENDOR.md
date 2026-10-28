# Vendored AI DJ modules (unmodified)

Source: https://github.com/hungryshmorez/AI-DJ-Mixing-System (fork of kckDeepak/AI-DJ-Mixing-System), commit `d56bd28c772f713ae39fc9ac33d0b555b98e1ce4`.
Licence: MIT, Copyright (c) 2025 Kuchi Chaitanya Krishna Deepak (`LICENSE` in this folder). Keep the notice if you redistribute.

| File | Used for | Needs |
|---|---|---|
| generate_mixing_plan.py | `calculate_key_compatibility`, `score_transition_candidate`, `select_best_transition_point`, `calculate_dynamic_overlap` : the decision layer | librosa (imported at top) |
| structure_detector.py | `extract_beat_times_fast`, `analyze_energy_curve` (local); its chorus/vocal detection uses OpenAI Whisper + GPT-4o and is NOT used here | numpy, scipy, librosa, python-dotenv |
| bpm_lookup.py | `estimate_bpm_with_librosa` (local) | librosa, python-dotenv |

Not vendored: `mixing_engine.py` (offline pydub renderer, not real-time), `track_analysis_openai_approach.py` (OpenAI song selection).
The files are byte-identical to the fork; verify with `sha256sum -c SHA256SUMS` in this folder.
