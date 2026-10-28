import { Handler } from '@netlify/functions';

export const handler: Handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const { interaction, aiPersonality } = body;

        // Input validation
        if (!interaction || !aiPersonality || typeof interaction !== 'object') {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid input: Missing interaction or aiPersonality' })
            };
        }

        // Logic to update personality based on interaction
        // This mirrors the frontend mock logic but would run server-side
        // persisting to a real database (e.g., FaunaDB, MongoDB)

        const evolvedPersonality = { ...aiPersonality };

        if (interaction.type === 'fader' && interaction.target === 'crossfader') {
             // Safe update with default fallback
             const currentEnergy = typeof evolvedPersonality.energyManagement === 'number' ? evolvedPersonality.energyManagement : 50;
             evolvedPersonality.energyManagement = Math.min(100, currentEnergy + 0.5);
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                evolvedPersonality,
                timestamp: new Date().toISOString()
            }),
        };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to process interaction' }) };
    }
};
