import { useEffect, useRef } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { GameRuntime } from '../runtime';
import { SEC_PER_TURN } from '../core/jog';
import { fmtTime } from './cdjColors';

/**
 * The jog wheel. The platter turns with the real playback position (one turn = SEC_PER_TURN of audio, the same scale the jog uses to scrub), and dragging it
 * sends signed turns to the deck through the runtime: pitch bend while playing, silent nudge while paused, hold-and-scrub in vinyl mode.
 * Pointer capture keeps the drag alive outside the wheel; release, cancel, lost capture, blur and unmount all end the touch, so the deck can never stay bent or held.
 */
export default function Jog({ rt, disabled }: { rt: GameRuntime; disabled: boolean }) {
    const wheel = useRef<HTMLDivElement>(null); const plat = useRef<HTMLDivElement>(null); const time = useRef<HTMLSpanElement>(null);
    const drag = useRef<{ id: number; last: number } | null>(null);

    useEffect(() => {
        let raf = 0;
        const loop = () => {
            if (rt.ready && plat.current) { const s = rt.stations.player.state(); plat.current.style.transform = `rotate(${((s.positionSec / SEC_PER_TURN) * 360) % 360}deg)`; if (time.current) time.current.textContent = s.trackId ? fmtTime(s.positionSec) : '--:--'; }
            raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        const end = () => { if (drag.current) { drag.current = null; rt.act('jog.touch', 0); } };
        window.addEventListener('blur', end);
        return () => { cancelAnimationFrame(raf); window.removeEventListener('blur', end); end(); };
    }, [rt]);

    const angle = (e: RPointerEvent) => { const r = wheel.current!.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
    const end = () => { if (drag.current) { drag.current = null; rt.act('jog.touch', 0); } };
    const mode = rt.cdj.jog.mode;

    return (
        <div className={`gjog ${disabled ? 'off' : ''}`} ref={wheel} role="group" aria-label="jog wheel" tabIndex={disabled ? -1 : 0} data-testid="jog"
            onPointerDown={e => { if (disabled || drag.current) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: e.pointerId, last: angle(e) }; rt.act('jog.touch', 1); }}
            onPointerMove={e => {
                const d = drag.current; if (!d || d.id !== e.pointerId) return;
                const a = angle(e); let dl = a - d.last; if (dl > Math.PI) dl -= 2 * Math.PI; if (dl < -Math.PI) dl += 2 * Math.PI; d.last = a;
                rt.jogTurns(dl / (2 * Math.PI));
            }}
            onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onBlur={end}
            onKeyDown={e => { if (disabled) return; if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); rt.jogTurns((e.key === 'ArrowRight' ? 1 : -1) * 0.02); } }}
            title={mode === 'cdj' ? 'Drag around the wheel: bends pitch while playing, nudges while paused' : 'Vinyl mode: touching holds the sound; move to scrub, let go to resume'}>
            <div className="gplat" ref={plat}><i className="gmark" /><i className="gmark b" /></div>
            <div className="gjogc"><span ref={time}>--:--</span><small>{mode === 'cdj' ? 'CDJ' : 'VINYL'}</small></div>
        </div>
    );
}
