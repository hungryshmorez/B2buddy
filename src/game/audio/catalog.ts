import { GameTrack } from '../core/types';

/** Spec of a bundled demo track. The audio is generated in the browser from this spec (audio/synth.ts): original, copyright-free, and the grid is exact by construction. */
export interface DemoSpec { id: string; title: string; bpm: number; key: string; rootHz: number; bars: number; seed: number; style: 'drive' | 'break' | 'deep' }

export const DEMO_SPECS: readonly DemoSpec[] = [
    { id: 'demo-neon-drill', title: 'Neon Drill', bpm: 124, key: '8A', rootHz: 55, bars: 8, seed: 11, style: 'drive' },
    { id: 'demo-harbour-pulse', title: 'Harbour Pulse', bpm: 126, key: '8B', rootHz: 49, bars: 8, seed: 23, style: 'deep' },
    { id: 'demo-velvet-static', title: 'Velvet Static', bpm: 122, key: '9A', rootHz: 61.7, bars: 8, seed: 37, style: 'break' },
    { id: 'demo-laser-tide', title: 'Laser Tide', bpm: 128, key: '7A', rootHz: 51.9, bars: 8, seed: 41, style: 'drive' },
    { id: 'demo-midnight-grid', title: 'Midnight Grid', bpm: 125, key: '9B', rootHz: 58.3, bars: 8, seed: 53, style: 'deep' },
    { id: 'demo-sunset-circuit', title: 'Sunset Circuit', bpm: 123, key: '8A', rootHz: 55, bars: 8, seed: 67, style: 'break' },
];

export function loopSeconds(s: DemoSpec) { return s.bars * 4 * 60 / s.bpm; }

export function demoTrack(s: DemoSpec): GameTrack {
    return { id: s.id, title: s.title, artist: 'B2Buddy demo', durationSec: 600, bpm: s.bpm, bpmOrigin: 'declared', firstBeatSec: 0, key: s.key, keyOrigin: 'declared', loopSec: loopSeconds(s), instrumental: true, source: 'bundled' };
}

export const DEMO_TRACKS: readonly GameTrack[] = DEMO_SPECS.map(demoTrack);
