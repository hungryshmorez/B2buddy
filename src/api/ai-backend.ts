// Mimic Netlify Function: process-interaction.ts
import { Interaction } from '../services/AILearningService';
import { AIPersonality } from '../types';

// In-memory store for simulation
let currentPersonality: AIPersonality = {
    riskTolerance: 50,
    energyManagement: 50,
    genreExploration: 30,
    crowdAdaptation: 50,
    learningVelocity: 10
};

export const processInteraction = async (interaction: Interaction): Promise<{ success: boolean, personality: AIPersonality }> => {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 50));

    // Logic moved from AILearningService
    if (interaction.type === 'fader' && interaction.target === 'crossfader') {
        currentPersonality.energyManagement = Math.min(100, currentPersonality.energyManagement + 0.5);
    }
    if (interaction.type === 'load_track') {
        currentPersonality.genreExploration = Math.min(100, currentPersonality.genreExploration + 1);
        currentPersonality.riskTolerance = Math.min(100, currentPersonality.riskTolerance + 0.2);
    }
    if (interaction.type === 'eq') {
        currentPersonality.crowdAdaptation = Math.min(100, currentPersonality.crowdAdaptation + 0.5);
    }

    return { success: true, personality: { ...currentPersonality } };
};

export const getAnalytics = async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
    return { personality: { ...currentPersonality } };
};
