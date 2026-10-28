export interface Track {
    id: string;
    title: string;
    artist: string;
    bpm: number;
    key: string;
    duration: number;
    url: string; // URL to audio file
    videoUrl?: string; // URL to video file (if VJ track)
    youtubeUrl?: string; // URL to YouTube video
    type: 'audio' | 'video' | 'youtube';
}

export interface Playlist {
    id: string;
    name: string;
    tracks: Track[];
}

export interface DeckState {
    track: Track | null;
    playing: boolean;
    bpm: number;
    pitch: number; // Percentage -10 to +10 usually
    volume: number;
    position: number; // Current playback position in seconds
}

export interface MixerState {
    crossfader: number; // -1 to 1
    // AV Mixer Expansion: 4 Channels
    // Ch 1: Deck A Audio
    // Ch 2: Deck A Video
    // Ch 3: Deck B Audio
    // Ch 4: Deck B Video
    channels: [ChannelState, ChannelState, ChannelState, ChannelState];
}

export interface ChannelState {
    volume: number; // 0-1 (Audio Vol or Video Opacity)
    high: number;
    mid: number;
    low: number;
}

export interface AIPersonality {
    riskTolerance: number; // 0-100
    energyManagement: number; // 0-100
    genreExploration: number; // 0-100
    crowdAdaptation: number; // 0-100
    learningVelocity: number; // 0-100
}

export interface SessionAnalytics {
    sessionId: string;
    startTime: number;
    duration: number;
    interactions: number;
    averageEnergy: number;
    aiPersonalitySnapshot: AIPersonality;
}
