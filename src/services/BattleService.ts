import { AIPersonality, Track } from '../types';
import { aiService } from './AILearningService';

export interface BattleState {
    isActive: boolean;
    round: number;
    maxRounds: number;
    playerScore: number;
    opponentScore: number;
    crowdReaction: number; // 0 to 100
    history: BattleRound[];
}

export interface BattleRound {
    roundNumber: number;
    playerTrack: Track | null;
    playerScore: number;
    opponentTrack: Track | null;
    opponentScore: number;
    winner: 'player' | 'opponent' | 'draw';
}

class BattleService {
    private state: BattleState = {
        isActive: false,
        round: 0,
        maxRounds: 3,
        playerScore: 0,
        opponentScore: 0,
        crowdReaction: 50,
        history: []
    };

    private listeners: ((state: BattleState) => void)[] = [];

    subscribe(callback: (state: BattleState) => void) {
        this.listeners.push(callback);
        callback(this.state);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    private notify() {
        this.listeners.forEach(l => l({ ...this.state }));
    }

    startBattle(rounds: number = 3) {
        this.state = {
            isActive: true,
            round: 1,
            maxRounds: rounds,
            playerScore: 0,
            opponentScore: 0,
            crowdReaction: 50,
            history: []
        };
        this.notify();
    }

    stopBattle() {
        this.state.isActive = false;
        this.notify();
    }

    // Called when the Player plays a track in Battle Mode
    submitPlayerTurn(track: Track) {
        if (!this.state.isActive) return;

        // Calculate Score
        // We use the User's current "Evolved" personality as a base for their skill level + Track properties
        const userPersonality = aiService.getPersonality();
        const score = this.calculateScore(userPersonality, track, this.state.crowdReaction, this.state.round);

        // Update State (Partial round update)
        // In a real turn-based game, we'd wait for AI.
        // For now, let's assume we store this and trigger AI immediately.
        this.handleTurnResolution(score, track);
    }

    private handleTurnResolution(playerScore: number, playerTrack: Track) {
        // AI Turn Logic (Simulated)
        const opponentPersonality: AIPersonality = {
            riskTolerance: 80,
            energyManagement: 70,
            genreExploration: 60,
            crowdAdaptation: 75,
            learningVelocity: 50
        };

        // Mock AI Track
        const aiTrack: Track = {
            id: 'ai_battle_1',
            title: 'Algorithm Rhythm',
            artist: 'Deep Blue',
            bpm: 128,
            key: 'Cm',
            duration: 300,
            url: '',
            type: 'audio'
        };

        const opponentScore = this.calculateScore(opponentPersonality, aiTrack, this.state.crowdReaction, this.state.round);

        // Determine Round Winner
        let winner: 'player' | 'opponent' | 'draw' = 'draw';
        if (playerScore > opponentScore) winner = 'player';
        if (opponentScore > playerScore) winner = 'opponent';

        // Update Totals
        this.state.playerScore += playerScore;
        this.state.opponentScore += opponentScore;

        // Add to History
        this.state.history.push({
            roundNumber: this.state.round,
            playerTrack,
            playerScore,
            opponentTrack: aiTrack,
            opponentScore,
            winner
        });

        // Advance Round
        if (this.state.round < this.state.maxRounds) {
            this.state.round++;
        } else {
            this.state.isActive = false; // Game Over
        }

        this.notify();
    }

    private calculateScore(personality: AIPersonality, _track: Track, crowdReaction: number, round: number): number {
        let baseScore = 5.0;

        // Personality bonuses (0-100 mapped to small bonuses)
        const personalityBonus = (
            personality.energyManagement * 0.02 +
            personality.crowdAdaptation * 0.02 +
            personality.riskTolerance * 0.01
        );

        // Round-based bonuses (strategic adaptation - later rounds favor exploration)
        const roundBonus = round > 1 ? personality.genreExploration * 0.01 : 0;

        // Crowd reaction impact (0-100 -> 0-2)
        const crowdBonus = (crowdReaction / 50);

        // Random factor for unpredictability (-1 to 1)
        const randomFactor = (Math.random() - 0.5) * 2;

        return Math.max(0, Math.min(10, baseScore + personalityBonus + roundBonus + crowdBonus + randomFactor));
    }

    getState() {
        return { ...this.state };
    }
}

export const battleService = new BattleService();
