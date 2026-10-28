import { aiService } from './AILearningService';
import { generateMusicRecommendations } from './MusicDiscoveryService';
import { Track } from '../types';

// Mock AI Logic for B2B Partner

class AIB2BService {
    private isEnabled: boolean = false;
    private intervalId: any = null;
    private onActionCallback: ((action: AIAction) => void) | null = null;
    private lastTrackPlayed: Track | null = null;

    startB2B(callback: (action: AIAction) => void) {
        this.isEnabled = true;
        this.onActionCallback = callback;
        console.log("AI B2B Partner Started");

        // Start the "Brain" loop
        this.intervalId = setInterval(() => {
            this.think();
        }, 5000); // AI thinks every 5 seconds
    }

    stopB2B() {
        this.isEnabled = false;
        if (this.intervalId) clearInterval(this.intervalId);
        this.onActionCallback = null;
        console.log("AI B2B Partner Stopped");
    }

    // Allow the main app to inform AI what track is currently playing on the OTHER deck
    notifyCurrentTrack(track: Track) {
        this.lastTrackPlayed = track;
    }

    private think() {
        if (!this.isEnabled || !this.onActionCallback) return;

        const personality = aiService.getPersonality();

        // Randomly decide to do something based on personality
        const roll = Math.random() * 100;

        if (roll < personality.riskTolerance) {
            // Do something "Risky" -> Like loading a new track
            this.decideTrackLoad(personality);
        } else if (roll < personality.energyManagement) {
            // Adjust volume or EQ
            this.decideMixing();
        }
    }

    private decideTrackLoad(personality: any) {
        // Use Music Discovery Engine
        const recommendations = generateMusicRecommendations(this.lastTrackPlayed, personality);

        if (recommendations.length > 0) {
            // Pick top recommendation
            const bestTrack = recommendations[0];

             this.onActionCallback!({
                type: 'LOAD_TRACK',
                deckId: 1, // AI controls Deck 2 (Index 1)
                payload: bestTrack
            });
        }
    }

    private decideMixing() {
        // AI fades crossfader
        const targetCrossfader = Math.random() > 0.5 ? 0.5 : -0.5; // Move towards center or side

        this.onActionCallback!({
            type: 'CROSSFADER',
            value: targetCrossfader
        });
    }
}

export interface AIAction {
    type: 'LOAD_TRACK' | 'CROSSFADER' | 'EQ';
    deckId?: number;
    value?: any;
    payload?: any;
}

export const aiB2BService = new AIB2BService();
