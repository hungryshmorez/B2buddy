/** Hot cue colours A-H, shared by the pads and the waveform so a pad and its marker always match. */
export const HOT_COLORS = ['#ff3b3b', '#ff9f1c', '#ffe14d', '#3bff7a', '#33ebff', '#4d7bff', '#b44dff', '#ff4ddb'] as const;
export const HOT_LETTERS = 'ABCDEFGH';
export const fmtTime = (s: number) => { s = Math.max(0, s); const m = Math.floor(s / 60); const r = s - m * 60; return `${m}:${Math.floor(r).toString().padStart(2, '0')}.${Math.floor((r % 1) * 10)}`; };
