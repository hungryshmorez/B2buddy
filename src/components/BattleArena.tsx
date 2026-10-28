import React, { useEffect, useState } from 'react';
import { battleService, BattleState } from '../services/BattleService';
import { Swords, Trophy, User, Cpu } from 'lucide-react';

const BattleArena: React.FC = () => {
    const [state, setState] = useState<BattleState>(battleService.getState());

    useEffect(() => {
        return battleService.subscribe(setState);
    }, []);

    const startBattle = () => {
        battleService.startBattle();
    };

    if (!state.isActive && state.history.length === 0) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-6 bg-gray-900 text-center">
                <Swords size={64} className="text-red-500 mb-4" />
                <h2 className="text-3xl font-bold mb-2">AI Battle Arena</h2>
                <p className="text-gray-400 mb-6">Challenge the AI to a 3-round mix-off.</p>
                <button
                    onClick={startBattle}
                    className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-full transition-all transform hover:scale-105"
                >
                    START BATTLE
                </button>
            </div>
        );
    }

    if (!state.isActive && state.history.length > 0) {
         // Game Over Screen
         const playerWon = state.playerScore > state.opponentScore;
         return (
            <div className="h-full flex flex-col items-center justify-center p-6 bg-gray-900 text-center">
                <Trophy size={64} className={playerWon ? "text-yellow-400 mb-4" : "text-gray-600 mb-4"} />
                <h2 className="text-3xl font-bold mb-2">{playerWon ? "YOU WON!" : "AI WINS"}</h2>
                <div className="flex gap-8 text-xl font-mono mb-6">
                    <div className="text-blue-400">YOU: {state.playerScore.toFixed(1)}</div>
                    <div className="text-red-400">AI: {state.opponentScore.toFixed(1)}</div>
                </div>
                <button
                    onClick={startBattle}
                    className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-6 rounded-full"
                >
                    REMATCH
                </button>
            </div>
         );
    }

    return (
        <div className="h-full flex flex-col bg-gray-900 border-r border-gray-700 w-80 p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-6 border-b border-gray-700 pb-4">
                <h2 className="text-xl font-bold flex items-center gap-2">
                    <Swords size={20} className="text-red-500" />
                    Battle Mode
                </h2>
                <div className="bg-red-900/50 text-red-200 text-xs px-2 py-1 rounded">
                    ROUND {state.round}/{state.maxRounds}
                </div>
            </div>

            {/* Scoreboard */}
            <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-blue-900/20 border border-blue-500/30 p-3 rounded-lg text-center">
                    <User className="mx-auto text-blue-400 mb-2" size={24} />
                    <div className="text-2xl font-bold text-white">{state.playerScore.toFixed(1)}</div>
                    <div className="text-xs text-blue-300">PLAYER</div>
                </div>
                <div className="bg-red-900/20 border border-red-500/30 p-3 rounded-lg text-center">
                    <Cpu className="mx-auto text-red-400 mb-2" size={24} />
                    <div className="text-2xl font-bold text-white">{state.opponentScore.toFixed(1)}</div>
                    <div className="text-xs text-red-300">OPPONENT</div>
                </div>
            </div>

            {/* Current Crowd Reaction */}
            <div className="mb-6">
                <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>Crowd Reaction</span>
                    <span>{state.crowdReaction}%</span>
                </div>
                <div className="w-full bg-gray-700 h-2 rounded-full overflow-hidden">
                    <div
                        className="h-full bg-gradient-to-r from-green-500 to-yellow-500 transition-all duration-500"
                        style={{ width: `${state.crowdReaction}%` }}
                    ></div>
                </div>
            </div>

            {/* History Feed */}
            <div className="flex-1">
                <h3 className="text-xs uppercase text-gray-500 font-bold mb-3">Battle Log</h3>
                <div className="space-y-3">
                    {state.history.slice().reverse().map((round, idx) => (
                        <div key={idx} className="bg-gray-800 p-3 rounded border border-gray-700 text-sm">
                            <div className="flex justify-between mb-2">
                                <span className="text-gray-400 font-bold">Round {round.roundNumber}</span>
                                <span className={
                                    round.winner === 'player' ? 'text-blue-400' :
                                    round.winner === 'opponent' ? 'text-red-400' : 'text-gray-400'
                                }>
                                    {round.winner === 'player' ? 'WIN' : round.winner === 'opponent' ? 'LOSS' : 'DRAW'}
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                    <div className="text-gray-500">You played</div>
                                    <div className="truncate">{round.playerTrack?.title || 'Unknown'}</div>
                                    <div className="font-mono text-blue-400">{round.playerScore.toFixed(1)} pts</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-gray-500">AI played</div>
                                    <div className="truncate">{round.opponentTrack?.title || 'Unknown'}</div>
                                    <div className="font-mono text-red-400">{round.opponentScore.toFixed(1)} pts</div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {state.history.length === 0 && (
                        <div className="text-center text-gray-600 text-xs italic mt-4">
                            Waiting for the first beat drop...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// Memoize to decouple from App state updates
export default React.memo(BattleArena);
