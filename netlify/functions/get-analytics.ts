import { Handler } from '@netlify/functions';

export const handler: Handler = async (event, context) => {
    if (event.httpMethod !== 'GET') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Mock Analytics Data
    const analytics = {
        aiPersonality: {
            riskTolerance: 75,
            energyManagement: 60,
            genreExploration: 80,
            crowdAdaptation: 55
        },
        sessionStats: {
            totalPlayTime: 3600,
            tracksPlayed: 12,
            averageBPM: 128
        },
        history: [
            { id: 1, action: 'Crossfader Transition', timestamp: Date.now() - 10000 },
            { id: 2, action: 'Load Track', timestamp: Date.now() - 50000 }
        ]
    };

    return {
        statusCode: 200,
        body: JSON.stringify(analytics),
    };
};
