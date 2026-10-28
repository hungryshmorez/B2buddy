import { MasterClock } from './clock';
import { Challenge, STANDARD } from './challenges';
import { Breakdown, RoundScorer } from './scoring';
import { GameTrack, StationControl, StationEvent, StationId, TimeSource } from './types';

export type Phase = 'idle' | 'countin' | 'live' | 'roundEnd' | 'matchEnd';
export type Winner = StationId | 'draw';

export interface BattleConfig {
    masterBpm: number; beatsPerBar: number; countInBars: number; roundSeconds: number; bestOf: number; leadSeconds: number; tieMargin: number;
}
export const DEFAULT_BATTLE: BattleConfig = { masterBpm: 124, beatsPerBar: 4, countInBars: 2, roundSeconds: 90, bestOf: 3, leadSeconds: 0.8, tieMargin: 1 };

export interface RoundResult { round: number; breakdown: Record<StationId, Breakdown>; winner: Winner; challenge: string }

export interface SessionDeps {
    time: TimeSource;
    stations: Record<StationId, StationControl>;
    library: ReadonlyMap<string, GameTrack>;
    events: (id: StationId, fn: (e: StationEvent) => void) => () => void;
    config?: Partial<BattleConfig>;
    challenge?: Challenge;
}

/** Round and match flow for one local battle. One master clock per round; both stations are scored by the same scorer from their real state. */
export class BattleSession {
    readonly config: BattleConfig;
    readonly challenge: Challenge;
    phase: Phase = 'idle';
    round = 0;
    clock: MasterClock | null = null;
    scorer: RoundScorer | null = null;
    readonly results: RoundResult[] = [];
    readonly wins: Record<StationId, number> = { player: 0, buddy: 0 };
    matchWinner: Winner | null = null;
    private listeners: Array<(p: Phase, s: BattleSession) => void> = [];

    constructor(private readonly d: SessionDeps) {
        this.config = { ...DEFAULT_BATTLE, ...d.config };
        this.challenge = d.challenge ?? STANDARD;
    }

    onPhase(fn: (p: Phase, s: BattleSession) => void) { this.listeners.push(fn); }
    private setPhase(p: Phase) { this.phase = p; for (const l of this.listeners) l(p, this); }

    get roundBeats() { return Math.ceil(this.config.roundSeconds * this.config.masterBpm / 60 / this.config.beatsPerBar) * this.config.beatsPerBar; }
    get countInBeats() { return this.config.countInBars * this.config.beatsPerBar; }
    get roundSec() { return this.roundBeats * 60 / this.config.masterBpm; }

    /** Null when the round can start, else why not. */
    canStart(): string | null {
        if (this.phase === 'countin' || this.phase === 'live') return 'A round is already running.';
        if (this.phase === 'matchEnd') return 'The match is over: start a rematch.';
        return this.challenge.requires([...this.d.library.values()], this.config.roundSeconds);
    }

    startRound(): string | null {
        const why = this.canStart(); if (why) return why;
        const now = this.d.time.now();
        this.round++;
        this.clock = new MasterClock(this.config.masterBpm, this.config.beatsPerBar, now + this.config.leadSeconds + this.countInBeats * 60 / this.config.masterBpm);
        this.scorer?.detach();
        this.scorer = new RoundScorer(this.clock, this.roundSec, id => this.d.library.get(id), this.challenge.weights, this.challenge.objective?.bind(this.challenge), this.d.events);
        this.scorer.attach('player', this.d.stations.player); this.scorer.attach('buddy', this.d.stations.buddy);
        this.setPhase('countin');
        return null;
    }

    tick() {
        const now = this.d.time.now();
        if (!this.clock) return;
        if (this.phase === 'countin' && now >= this.clock.beat0Time) this.setPhase('live');
        if (this.phase === 'live' || this.phase === 'countin') this.scorer?.sample(now);
        if (this.phase === 'live' && now >= this.clock.beat0Time + this.roundSec) this.endRound();
    }

    private endRound() {
        const sc = this.scorer!;
        for (const id of ['player', 'buddy'] as StationId[]) this.d.stations[id].pause();
        const bd = { player: sc.breakdown('player'), buddy: sc.breakdown('buddy') };
        sc.detach();
        const diff = bd.player.total - bd.buddy.total;
        const winner: Winner = Math.abs(diff) < this.config.tieMargin ? 'draw' : diff > 0 ? 'player' : 'buddy';
        if (winner !== 'draw') this.wins[winner]++;
        this.results.push({ round: this.round, breakdown: bd, winner, challenge: this.challenge.id });
        const need = Math.floor(this.config.bestOf / 2) + 1;
        const decided = this.wins.player >= need || this.wins.buddy >= need || this.round >= this.config.bestOf;
        if (decided) {
            const t = (id: StationId) => this.results.reduce((s, r) => s + r.breakdown[id].total, 0);
            this.matchWinner = this.wins.player !== this.wins.buddy ? (this.wins.player > this.wins.buddy ? 'player' : 'buddy')
                : Math.abs(t('player') - t('buddy')) < this.config.tieMargin ? 'draw' : t('player') > t('buddy') ? 'player' : 'buddy';
            this.setPhase('matchEnd');
        } else this.setPhase('roundEnd');
    }

    /** A brand-new match with the same settings. */
    rematch() {
        this.scorer?.detach(); this.scorer = null; this.clock = null; this.round = 0; this.results.length = 0; this.wins.player = this.wins.buddy = 0; this.matchWinner = null;
        this.setPhase('idle');
    }
}
