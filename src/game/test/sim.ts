import { BuddyAI, Difficulty, BuddyPrefs } from '../ai/buddy';
import { BattleSession, BattleConfig, Phase } from '../core/battle';
import { Challenge } from '../core/challenges';
import { CommandPort } from '../core/commands';
import { SilentBackend, Station } from '../core/station';
import { GameTrack, StationId } from '../core/types';
import { DEMO_TRACKS } from '../audio/catalog';

/** A whole battle without audio hardware: a manual clock, silent backends, the real stations/session/scorer/AI. */
export class Sim {
    t = 0;
    readonly player: Station; readonly buddy: Station;
    readonly library = new Map<string, GameTrack>();
    readonly session: BattleSession;
    readonly ai: BuddyAI; readonly port: CommandPort;
    prefs: BuddyPrefs = {};
    constructor(difficulty: Difficulty, cfg: Partial<BattleConfig> = {}, challenge?: Challenge, seed = 1, tracks: readonly GameTrack[] = DEMO_TRACKS) {
        const clock = () => this.t;
        this.player = new Station('player', new SilentBackend(clock)); this.buddy = new Station('buddy', new SilentBackend(clock));
        for (const tr of tracks) this.library.set(tr.id, tr);
        this.session = new BattleSession({ time: { now: clock }, stations: { player: this.player, buddy: this.buddy }, library: this.library,
            events: (id: StationId, fn) => (id === 'player' ? this.player : this.buddy).onEvent(fn), config: cfg, challenge });
        this.port = new CommandPort('buddy', this.buddy, this.library, clock);
        this.ai = new BuddyAI(this.port, this.session, tracks, difficulty, clock, () => this.prefs, seed, () => this.player.state().trackId);
    }
    /** Advance time in 20 ms frames, running the session and the AI like the game loop does. */
    run(seconds: number, each?: (sim: Sim) => void) {
        const end = this.t + seconds;
        while (this.t < end - 1e-9) { this.t += 0.02; this.session.tick(); this.ai.tick(); each?.(this); }
    }
    runUntil(phase: Phase, max = 1200, each?: (sim: Sim) => void) { const lim = this.t + max; while (this.session.phase !== phase && this.t < lim) this.run(0.02, each); }
    /** A competent player: matches tempo exactly, starts on the first beat, never touches anything else. */
    playerPlaysClean(trackId = DEMO_TRACKS[0].id) {
        const tr = this.library.get(trackId)!; this.player.load(tr);
        this.player.setRate(this.session.config.masterBpm / tr.bpm!);
        this.player.seek(tr.firstBeatSec);
        return () => { if (!this.player.state().playing && this.session.clock) this.player.play(this.session.clock.timeOfBeat(0)); };
    }
}
