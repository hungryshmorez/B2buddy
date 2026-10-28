import { AIPersonality } from '../types';
import { processInteraction, getAnalytics } from '../api/ai-backend';

export interface Interaction {
    type: 'fader' | 'eq' | 'load_track' | 'play_pause';
    target: string;
    value: any;
    timestamp: number;
}

class AILearningService {
    private interactions: Interaction[] = [];
    private sessionStartTime: number = Date.now();
    private personality: AIPersonality = {
        riskTolerance: 50,
        energyManagement: 50,
        genreExploration: 30,
        crowdAdaptation: 50,
        learningVelocity: 10
    };

    private listeners: ((p: AIPersonality) => void)[] = [];

    constructor() {
        // Initial sync
        this.syncWithBackend();
    }

    private async syncWithBackend() {
        const data = await getAnalytics();
        this.personality = data.personality;
        this.notify();
    }

    subscribe(callback: (p: AIPersonality) => void) {
        this.listeners.push(callback);
        callback(this.personality);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    private notify() {
        this.listeners.forEach(l => l(this.personality));
    }

    async logInteraction(type: Interaction['type'], target: string, value: any) {
        const interaction: Interaction = {
            type,
            target,
            value,
            timestamp: Date.now()
        };
        this.interactions.push(interaction);
        console.debug('AI Log:', interaction);

        // Call Backend API
        try {
            const response = await processInteraction(interaction);
            if (response.success) {
                this.personality = response.personality;
                this.notify();
            }
        } catch (e) {
            console.error("Failed to sync interaction with backend", e);
        }
    }

    getPersonality(): AIPersonality {
        return { ...this.personality };
    }

    getSessionSummary() {
        return {
            duration: Date.now() - this.sessionStartTime,
            interactionCount: this.interactions.length,
            interactions: this.interactions,
            finalPersonality: this.personality
        };
    }
}

export const aiService = new AILearningService();
