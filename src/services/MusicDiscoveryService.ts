import { Track, AIPersonality } from '../types';

// Mock database of potential tracks
const MUSIC_DATABASE: Track[] = [
    { id: 'db_1', title: 'Cyber Pulse', artist: 'AI Bot', bpm: 130, key: 'F#', duration: 300, url: '/samples/industrial.mp3', type: 'audio' },
    { id: 'db_2', title: 'Neural Net', artist: 'Deep Mind', bpm: 126, key: 'Am', duration: 280, url: '/samples/deep.mp3', type: 'audio' },
    { id: 'db_3', title: 'Solar Flare', artist: 'Star System', bpm: 124, key: 'G', duration: 310, url: '/samples/sunset.mp3', type: 'audio' },
    { id: 'db_4', title: 'Acid Rain', artist: 'Techno Viking', bpm: 128, key: 'Am', duration: 345, url: '/samples/acid.mp3', type: 'audio' },
    { id: 'db_5', title: 'Void Walker', artist: 'Null Pointer', bpm: 140, key: 'Dm', duration: 290, url: '/samples/industrial.mp3', type: 'audio' },
    { id: 'db_6', title: 'Soft Clouds', artist: 'Sky High', bpm: 120, key: 'C', duration: 250, url: '/samples/deep.mp3', type: 'audio' },
];

export const generateMusicRecommendations = (
    currentTrack: Track | null,
    personality: AIPersonality
): Track[] => {
    if (!currentTrack) {
        // If no track playing, return random selection
        return MUSIC_DATABASE.sort(() => 0.5 - Math.random()).slice(0, 3);
    }

    // Logic from prompt:
    // 1. Analyze current track (BPM, Key)
    // 2. Find compatible tracks
    // 3. Apply personality influence (Genre Exploration, Risk Tolerance)

    const recommended = MUSIC_DATABASE.filter(track => {
        if (track.id === currentTrack.id) return false;

        // BPM Compatibility (simple range)
        const bpmDiff = Math.abs(track.bpm - currentTrack.bpm);
        const isBpmCompatible = bpmDiff <= 5; // standard mixing range

        // Key Compatibility (very simple mock: same key or relative major/minor mock)
        const isKeyCompatible = track.key === currentTrack.key || track.key === 'Am' && currentTrack.key === 'C'; // simplistic

        // Score this track
        let score = 0;
        if (isBpmCompatible) score += 50;
        if (isKeyCompatible) score += 30;

        // Personality Influence

        // High Risk Tolerance -> Favor larger BPM gaps or key mismatches?
        // Actually, the prompt says "Risk Tolerance: Musical boldness".
        // Let's say if Risk > 70, we ignore BPM compatibility rules slightly.
        if (personality.riskTolerance > 70) {
            if (bpmDiff > 5 && bpmDiff < 15) score += 20; // Bonus for "risky" bpm changes
        }

        // Genre Exploration (Mocked by artist/title variance here as we don't have genre field in Track type yet)
        // Let's pretend tracks with ID > 3 are "New Genres"
        if (personality.genreExploration > 60 && track.id > 'db_3') {
            score += 25;
        }

        return score > 30; // Threshold
    });

    // Sort by score (mocked shuffle for now as we didn't store the score per track in map)
    return recommended.length > 0 ? recommended : MUSIC_DATABASE.slice(0, 3);
};
