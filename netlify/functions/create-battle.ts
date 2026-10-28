import { Handler } from '@netlify/functions';

export const handler: Handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { rounds = 3, difficulty = 'normal' } = JSON.parse(event.body || '{}');

        const battleId = `battle_${Date.now()}`;

        // Initialize Battle State
        const battleState = {
            id: battleId,
            rounds,
            difficulty,
            status: 'active',
            currentRound: 1,
            scores: { player: 0, ai: 0 }
        };

        return {
            statusCode: 200,
            body: JSON.stringify(battleState),
        };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create battle' }) };
    }
};
