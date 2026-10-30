import { StationBackend } from '../core/station';
import { GameTrack, LoopSpan } from '../core/types';

const EQ_DB = (k: number) => (k <= 0.5 ? -26 + (k / 0.5) * 26 : ((k - 0.5) / 0.5) * 6);

/** Master bus shared by both stations: headroom -> a compressor that only acts near full scale -> analyser -> speakers. */
export class MasterBus {
    readonly input: GainNode; readonly limiter: DynamicsCompressorNode; readonly analyser: AnalyserNode; readonly master: GainNode;
    constructor(readonly ctx: AudioContext) {
        this.input = ctx.createGain(); this.input.gain.value = 0.8;
        // threshold near 0 dBFS: ordinary levels pass untouched (natural dynamics), only peaks that would clip are spread out
        this.limiter = ctx.createDynamicsCompressor(); this.limiter.threshold.value = -3; this.limiter.knee.value = 3; this.limiter.ratio.value = 12; this.limiter.attack.value = 0.003; this.limiter.release.value = 0.12;
        this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 1024; this.analyser.smoothingTimeConstant = 0.6;
        this.master = ctx.createGain(); this.master.gain.value = 0.9;
        this.input.connect(this.limiter); this.limiter.connect(this.analyser); this.analyser.connect(this.master); this.master.connect(ctx.destination);
    }
}

/** One station's signal chain. The Station class owns the playback arithmetic; this only makes it audible. */
export class WebAudioBackend implements StationBackend {
    private src: AudioBufferSourceNode | null = null;
    private track: GameTrack | null = null;
    readonly low: BiquadFilterNode; readonly mid: BiquadFilterNode; readonly high: BiquadFilterNode; readonly filt: BiquadFilterNode; readonly vol: GainNode; readonly analyser: AnalyserNode;
    private readonly head: GainNode;
    private rate = 1;
    private userLoop: LoopSpan | null = null;
    constructor(private readonly ctx: AudioContext, bus: MasterBus, private readonly buffers: Map<string, AudioBuffer>) {
        this.head = ctx.createGain();
        this.low = ctx.createBiquadFilter(); this.low.type = 'lowshelf'; this.low.frequency.value = 200;
        this.mid = ctx.createBiquadFilter(); this.mid.type = 'peaking'; this.mid.frequency.value = 1000; this.mid.Q.value = 0.7;
        this.high = ctx.createBiquadFilter(); this.high.type = 'highshelf'; this.high.frequency.value = 4000;
        this.filt = ctx.createBiquadFilter(); this.filt.type = 'allpass';
        this.vol = ctx.createGain(); this.vol.gain.value = 0.8 * 0.8;
        this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 512; this.analyser.smoothingTimeConstant = 0.5;
        this.head.connect(this.low); this.low.connect(this.mid); this.mid.connect(this.high); this.high.connect(this.filt); this.filt.connect(this.vol); this.vol.connect(this.analyser); this.vol.connect(bus.input);
    }
    now() { return this.ctx.currentTime; }
    onLoad(track: GameTrack) { this.track = track; this.stopSrc(); }
    onStart(offsetSec: number, rate: number, atTime: number) {
        this.stopSrc();
        const buf = this.track ? this.buffers.get(this.track.id) : undefined; if (!buf || !this.track) return;
        const s = this.ctx.createBufferSource(); s.buffer = buf; this.rate = rate; s.playbackRate.value = rate;
        this.applyLoop(s);
        s.connect(this.head);
        const off = this.track.loopSec ? offsetSec % this.track.loopSec : Math.min(offsetSec, Math.max(0, buf.duration - 0.001));
        s.start(Math.max(atTime, this.ctx.currentTime), off); this.src = s;
    }
    onStop() { this.stopSrc(); }
    /** User loop in track seconds. Applied live to the running source (no restart, so no click) and remembered for the next start. */
    onLoop(loop: LoopSpan | null) { this.userLoop = loop; if (this.src) this.applyLoop(this.src); }
    private applyLoop(s: AudioBufferSourceNode) {
        if (this.userLoop) { s.loopStart = this.userLoop.start; s.loopEnd = this.userLoop.end; s.loop = true; }
        else if (this.track?.loopSec) { s.loopStart = 0; s.loopEnd = this.track.loopSec; s.loop = true; }
        else { s.loop = false; }
    }
    private stopSrc() { if (this.src) { try { this.src.stop(); } catch { /* already stopped */ } this.src.disconnect(); this.src = null; } }
    onRate(rate: number) { this.rate = rate; this.src?.playbackRate.setValueAtTime(rate, this.ctx.currentTime); }
    onParam(name: 'volume' | 'low' | 'mid' | 'high' | 'filter', v: number) {
        const t = this.ctx.currentTime;
        if (name === 'volume') this.vol.gain.setTargetAtTime(v * v, t, 0.008);
        else if (name === 'filter') {
            if (Math.abs(v - 0.5) < 0.03) { this.filt.type = 'allpass'; return; }
            if (v < 0.5) { this.filt.type = 'lowpass'; this.filt.frequency.setTargetAtTime(20000 * Math.pow(0.01, (0.47 - v) / 0.47), t, 0.01); }
            else { this.filt.type = 'highpass'; this.filt.frequency.setTargetAtTime(20 * Math.pow(200, (v - 0.53) / 0.47), t, 0.01); }
        } else (name === 'low' ? this.low : name === 'mid' ? this.mid : this.high).gain.setTargetAtTime(EQ_DB(v), t, 0.01);
    }
    /** Time-domain peak 0..1 of this channel, for meters. */
    peak(buf: Float32Array): number { this.analyser.getFloatTimeDomainData(buf as Float32Array<ArrayBuffer>); let p = 0; for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i])); return p; }
    get currentRate() { return this.rate; }
}
