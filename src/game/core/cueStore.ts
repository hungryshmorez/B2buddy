import { CueData, CueStore, HOT_CUES } from './types';
import type { KeyValueStorage } from '../memory/store';

const KEY = 'b2buddy.cues.v1';

/** Per-track cue points and hot cues in localStorage, keyed by GameTrack.id. Corrupt or foreign data is ignored, never trusted. */
export class StorageCueStore implements CueStore {
    private tracks: Record<string, CueData> = {};
    constructor(private readonly storage: KeyValueStorage) {
        try {
            const raw = storage.getItem(KEY); const j = raw ? JSON.parse(raw) : null;
            if (j && j.version === 1 && j.tracks && typeof j.tracks === 'object') {
                for (const [id, v] of Object.entries(j.tracks as Record<string, unknown>)) { const d = clean(v); if (d) this.tracks[id] = d; }
            }
        } catch { this.tracks = {}; }
    }
    load(trackId: string): CueData | null { const d = this.tracks[trackId]; return d ? { cue: d.cue, hot: [...d.hot] } : null; }
    save(trackId: string, data: CueData) {
        const d = clean(data); if (!d) return;
        if (d.cue === null && d.hot.every(h => h === null)) delete this.tracks[trackId]; else this.tracks[trackId] = d;
        try { this.storage.setItem(KEY, JSON.stringify({ version: 1, tracks: this.tracks })); } catch { /* storage blocked: cues last for this session only */ }
    }
    get trackCount() { return Object.keys(this.tracks).length; }
}

function clean(v: unknown): CueData | null {
    const x = v as CueData; if (!x || typeof x !== 'object' || !Array.isArray(x.hot)) return null;
    const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null);
    const hot = Array.from({ length: HOT_CUES }, (_, i) => num(x.hot[i]));
    return { cue: num(x.cue), hot };
}
