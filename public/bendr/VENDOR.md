# Vendored BENDR (unmodified)

Source: https://github.com/hungryshmorez/bendr (fork of clickysteve's BENDR), commit `3c966ab10a471f983466a6e76ff1711a2f5216a4`, BENDR v38.7.
Licence: MIT, Copyright (c) 2026 Steve Blythe (`LICENSE` here). Keep the notice if you redistribute.
`index.html` is the fork's built single-file app, byte-identical (`sha256sum -c SHA256SUMS`). B2Buddy never edits it: it hosts it in a same-origin iframe and
drives it through its own globals (see `src/game/video/bendrEngine.ts`), so the dependency is pinned to this version.
BENDR can produce rapid full-frame flashing; B2Buddy filters strobe-type presets by default and shows its own warning.
