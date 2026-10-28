import React, { useEffect, useState } from 'react';
import { aiService } from '../services/AILearningService';
import { predictionService } from '../services/PredictionService';
import { AIPersonality } from '../types';
import { BarChart2, Activity, Zap, Users, Brain, TrendingUp } from 'lucide-react';

const AnalyticsDashboard: React.FC = () => {
    const [personality, setPersonality] = useState<AIPersonality>(aiService.getPersonality());
    const [stats, setStats] = useState(aiService.getSessionSummary());
    const [prediction, setPrediction] = useState<number | null>(null);

    useEffect(() => {
        const unsub = aiService.subscribe((p) => {
            setPersonality(p);
            setStats(aiService.getSessionSummary());
        });
        return unsub;
    }, []);

    useEffect(() => {
        // Mock Training Data for Demo purposes
        // In a real app, this would come from historical sessions
        const mockHistory = [
            { bpm: 120, energy: 0.5, duration: 300, nextBpm: 124 },
            { bpm: 124, energy: 0.6, duration: 250, nextBpm: 128 },
            { bpm: 128, energy: 0.8, duration: 400, nextBpm: 130 },
            { bpm: 130, energy: 0.9, duration: 200, nextBpm: 125 },
        ];

        predictionService.trainOnHistory(mockHistory).then(() => {
            const pred = predictionService.predictNextBPM(128, 0.7, 300);
            setPrediction(pred);
        });
    }, []);

    const TraitBar = ({ label, value, icon: Icon, color }: { label: string, value: number, icon: any, color: string }) => (
        <div className="mb-4">
            <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-2 text-gray-300">
                    <Icon size={16} className={color} />
                    <span className="text-sm font-medium">{label}</span>
                </div>
                <span className="text-sm font-mono">{Math.round(value)}%</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-2.5">
                <div
                    className={`h-2.5 rounded-full transition-all duration-1000 ${color.replace('text-', 'bg-')}`}
                    style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                ></div>
            </div>
        </div>
    );

    return (
        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 h-full overflow-y-auto">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
                <BarChart2 className="text-purple-500" />
                AI Partner Analytics
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Personality Matrix */}
                <div className="bg-gray-900 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold mb-4 text-purple-400">Personality Matrix</h3>
                    <TraitBar label="Risk Tolerance" value={personality.riskTolerance} icon={Activity} color="text-red-500" />
                    <TraitBar label="Energy Management" value={personality.energyManagement} icon={Zap} color="text-yellow-500" />
                    <TraitBar label="Crowd Adaptation" value={personality.crowdAdaptation} icon={Users} color="text-blue-500" />
                    <TraitBar label="Genre Exploration" value={personality.genreExploration} icon={Brain} color="text-purple-500" />

                    <div className="mt-6 p-4 bg-gray-800 rounded border border-gray-700">
                        <h4 className="text-xs uppercase text-gray-500 font-bold mb-2">AI Evolution Status</h4>
                        <p className="text-sm text-gray-300">
                            Learning Velocity: <span className="text-green-400">{personality.learningVelocity}%</span>
                        </p>
                    </div>
                </div>

                {/* Session Stats */}
                <div className="bg-gray-900 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold mb-4 text-purple-400">Current Session</h3>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div className="bg-gray-800 p-4 rounded text-center">
                            <div className="text-3xl font-bold text-white">{stats.interactionCount}</div>
                            <div className="text-xs text-gray-500 uppercase mt-1">Interactions</div>
                        </div>
                        <div className="bg-gray-800 p-4 rounded text-center">
                            <div className="text-3xl font-bold text-white">{Math.floor(stats.duration / 1000 / 60)}m</div>
                            <div className="text-xs text-gray-500 uppercase mt-1">Duration</div>
                        </div>
                    </div>

                    {/* AI Prediction Widget */}
                    <div className="bg-gradient-to-r from-purple-900/50 to-blue-900/50 p-4 rounded border border-purple-500/30 mb-6">
                        <div className="flex items-center gap-2 mb-2">
                            <TrendingUp className="text-green-400" size={18} />
                            <h4 className="font-bold text-sm text-gray-200">AI Predictive Insight</h4>
                        </div>
                        <div className="text-xs text-gray-400 mb-2">Based on your recent mix history, the AI predicts the optimal next track BPM:</div>
                        <div className="text-2xl font-mono font-bold text-white">
                            {prediction ? `${prediction} BPM` : 'Learning...'}
                        </div>
                    </div>

                    <div className="mt-6">
                        <h4 className="text-xs uppercase text-gray-500 font-bold mb-2">Recent Activity Log</h4>
                        <div className="h-48 overflow-y-auto space-y-2 text-xs font-mono bg-black p-2 rounded">
                            {stats.interactions.slice().reverse().map((int, i) => (
                                <div key={i} className="text-gray-400 border-b border-gray-800 pb-1 mb-1">
                                    <span className="text-purple-500">[{new Date(int.timestamp).toLocaleTimeString()}]</span> {int.type} @ {int.target}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AnalyticsDashboard;
