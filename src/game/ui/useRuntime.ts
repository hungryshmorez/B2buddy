import { useEffect, useState } from 'react';
import { GameRuntime } from '../runtime';

let instance: GameRuntime | null = null;
/** One runtime per page (React StrictMode mounts twice; the audio graph must not). */
export function getRuntime(): GameRuntime {
    if (!instance) {
        let store: Storage | { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
        try { store = window.localStorage; store.getItem('b2buddy.probe'); } catch { const m = new Map<string, string>(); store = { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } }; }
        instance = new GameRuntime(store);
        (window as unknown as { __b2b?: GameRuntime }).__b2b = instance;       // handle for the browser test run and for debugging
    }
    return instance;
}

/** Re-render on runtime events and about 20 times a second (positions, meters, countdowns are read live, not stored). */
export function useRuntime(fps = 20): GameRuntime {
    const rt = getRuntime(); const [, set] = useState(0);
    useEffect(() => {
        const bump = () => set(n => (n + 1) % 1e9);
        const un = rt.subscribe(bump); const id = setInterval(bump, 1000 / fps);
        return () => { un(); clearInterval(id); };
    }, [rt, fps]);
    return rt;
}
