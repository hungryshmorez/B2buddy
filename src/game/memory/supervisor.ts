import { Decision } from '../ai/buddy';
import { RoundResult } from '../core/battle';
import { MemoryStore, PROJECT_RULES } from './store';

export type CorrectionKind = 'wait-for-phrase' | 'longer-fade' | 'no-filter';
export const CORRECTIONS: Record<CorrectionKind, { label: string; key: 'phraseWait' | 'fadeBeats' | 'avoidFilter'; value: boolean | number; text: string }> = {
    'wait-for-phrase': { label: 'Wait until the end of the phrase to transition', key: 'phraseWait', value: true, text: 'Wait until the end of the phrase before changing tracks.' },
    'longer-fade': { label: 'Use a longer fade (16 beats)', key: 'fadeBeats', value: 16, text: 'Fade over 16 beats when changing tracks.' },
    'no-filter': { label: 'Do not use filter sweeps', key: 'avoidFilter', value: true, text: 'Avoid filter sweeps during transitions.' },
};

export interface RoundReport { matchId: string; difficulty: string; decisions: readonly Decision[]; result: RoundResult; refusedCommands: number; activePrefsApplied: string[] }

/**
 * After every round: records structured experience, proposes (never applies) lessons backed by measured evidence, and checks Buddy's behaviour against the
 * approved preferences and the project rules. It never edits a durable rule or an approved preference by itself.
 */
export class Supervisor {
    constructor(private readonly memory: MemoryStore) {}

    analyze(r: RoundReport) {
        const m = this.memory; const prefs = m.buddyPrefs();
        const winner = r.result.winner === 'draw' ? 'draw' : r.result.winner === 'buddy' ? 'Buddy' : 'player';
        const outcome = { player: r.result.breakdown.player.total, buddy: r.result.breakdown.buddy.total, winner };
        const changeItem = r.result.breakdown.buddy.items.find(i => i.category === 'changes');
        // 1. structured experience: the decisions that mattered, with evidence and the measured outcome
        for (const d of r.decisions.filter(x => x.kind === 'transition' || x.kind === 'launch' || x.kind === 'tempo'))
            m.addExperience({ matchId: r.matchId, round: r.result.round, difficulty: r.difficulty, decision: d.decision, evidence: d.evidence, action: d.action, outcome });
        // 2. lessons from measurement
        const transitions = r.decisions.filter(d => d.kind === 'transition' && d.offPhraseBeats !== undefined);
        const off = transitions.filter(d => d.offPhraseBeats! > 2);
        if (off.length && !prefs.phraseWait) {
            const c = CORRECTIONS['wait-for-phrase'];
            m.propose(c.key, c.value, c.label, `${off.length} of ${transitions.length} transitions this round came more than 2 beats away from a phrase boundary` + (changeItem ? `; track-change score ${changeItem.points}/${changeItem.outOf}` : ''),
                Math.min(0.9, 0.5 + 0.2 * off.length), 'every battle, any difficulty', off.map(d => `${d.decision} (${d.offPhraseBeats!.toFixed(1)} beats off)`));
        }
        // 3. drift: behaviour against approved preferences and rules
        if (prefs.phraseWait) for (const d of transitions) if (d.offPhraseBeats! > 1) m.addDrift('preference-violated', `Approved preference "wait for the phrase" was broken: ${d.decision} was ${d.offPhraseBeats!.toFixed(1)} beats off the phrase (round ${r.result.round}).`);
        if (r.refusedCommands > 0) m.addDrift('refused-commands', `Buddy attempted ${r.refusedCommands} command(s) that the command port refused (rule: ${PROJECT_RULES.find(x => x.id === 'ai-owns-own-station')!.text}).`);
    }

    /** The DJ corrects a specific decision; this only creates a pending proposal. */
    correct(experienceId: string, kind: CorrectionKind) {
        const m = this.memory; const e = m.state.experiences.find(x => x.id === experienceId); if (!e) return null;
        const c = CORRECTIONS[kind]; e.correction = c.label;
        const p = m.propose(c.key, c.value, c.label, `You corrected: "${e.decision}"`, 0.7, 'future battles', [`${e.decision}: ${e.evidence}`]);
        e.lesson = p ? `proposed: ${c.label}` : 'already known';
        m.touch(); return p;
    }
}
