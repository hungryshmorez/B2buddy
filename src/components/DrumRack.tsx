import React, { useState, useEffect } from 'react';
import * as Tone from 'tone';

// Extended type for samples including optional video
interface DrumSample {
    note: string;
    name: string;
    color: string;
    url: string;
    videoUrl?: string; // New: Video clip for VJ sampling
}

const DEFAULT_SAMPLES: DrumSample[] = [
    { note: 'C3', name: 'Kick', color: 'bg-red-500', url: 'https://tonejs.github.io/audio/drum-samples/CR78/kick.mp3' },
    { note: 'D3', name: 'Snare', color: 'bg-yellow-500', url: 'https://tonejs.github.io/audio/drum-samples/CR78/snare.mp3' },
    { note: 'E3', name: 'HiHat', color: 'bg-blue-500', url: 'https://tonejs.github.io/audio/drum-samples/CR78/hihat.mp3' },
    { note: 'F3', name: 'Clap', color: 'bg-orange-500', url: 'https://tonejs.github.io/audio/drum-samples/CR78/tom1.mp3' },
    { note: 'G3', name: 'Perc 1', color: 'bg-purple-500', url: 'https://tonejs.github.io/audio/drum-samples/CR78/tom2.mp3' },
    { note: 'A3', name: 'Perc 2', color: 'bg-green-500', url: 'https://tonejs.github.io/audio/drum-samples/CR78/tom3.mp3' },
    { note: 'B3', name: 'OH', color: 'bg-pink-500', url: 'https://tonejs.github.io/audio/drum-samples/CR78/bongo1.mp3' },
    { note: 'C4', name: 'Crash', color: 'bg-teal-500', url: 'https://tonejs.github.io/audio/drum-samples/CR78/bongo2.mp3' },
];

interface DrumRackProps {
    pendingSample: { url: string, name: string } | null;
    onSampleAssigned: () => void;
    onTriggerVideo?: (url: string) => void; // Callback to trigger video overlay
}

const DrumRack: React.FC<DrumRackProps> = ({ pendingSample, onSampleAssigned, onTriggerVideo }) => {
    const [sampler, setSampler] = useState<Tone.Sampler | null>(null);
    const [activePad, setActivePad] = useState<string | null>(null);
    const [padConfig, setPadConfig] = useState<DrumSample[]>(DEFAULT_SAMPLES);

    useEffect(() => {
        const sampleMap: {[key: string]: string} = {};
        padConfig.forEach(s => sampleMap[s.note] = s.url);

        const newSampler = new Tone.Sampler({
            urls: sampleMap,
            onload: () => console.log('Drum samples loaded'),
        }).toDestination();

        setSampler(newSampler);

        return () => {
            newSampler.dispose();
        };
    }, []);

    const triggerPad = async (note: string, sample: DrumSample) => {
        if (!sampler) return;
        await Tone.start();
        sampler.triggerAttack(note);
        setActivePad(note);

        // Trigger Video if exists
        if (sample.videoUrl && onTriggerVideo) {
            onTriggerVideo(sample.videoUrl);
        }

        setTimeout(() => setActivePad(null), 100);
    };

    const handlePadClick = (index: number) => {
        const pad = padConfig[index];
        if (pendingSample) {

            // Update pad config
            const newConfig = [...padConfig];

            // If it's a video file, we use it for BOTH audio (if browser supports playing) or just visuals?
            // User requirement: "queue up videos and sample them for visuals".
            // If it's a video file, we assign it to videoUrl.
            // Ideally we extract audio, but for MVP we might just use the same URL for audio if Tone supports it (it usually doesn't support video files directly).
            // So we might need to assume the user provides audio samples separate from video samples, or we treat video files as "Visual Only" triggers?
            // Let's assume visual triggers for now if it's a video file.

            const updatedSample: DrumSample = {
                ...pad,
                name: pendingSample.name,
                url: pendingSample.url, // If video, Tone might fail to load audio.
                videoUrl: pendingSample.url // Assign as video source
            };

            newConfig[index] = updatedSample;
            setPadConfig(newConfig);

            // Reload Sampler (Same as before)
            if (sampler) sampler.dispose();
            const sampleMap: {[key: string]: string} = {};
            newConfig.forEach(s => sampleMap[s.note] = s.url);
            const newSampler = new Tone.Sampler({
                urls: sampleMap,
                onload: () => console.log('Drum samples reloaded'),
            }).toDestination();
            setSampler(newSampler);

            onSampleAssigned();
        } else {
            triggerPad(pad.note, pad);
        }
    };

    return (
        <div className={`bg-gray-800 p-4 rounded-lg border ${pendingSample ? 'border-yellow-400 animate-pulse' : 'border-gray-700'}`}>
            <div className="flex justify-between items-center mb-3">
                 <h3 className="text-gray-400 font-bold uppercase text-xs tracking-wider">Drum Rack (AV)</h3>
                 {pendingSample && <span className="text-xs text-yellow-400 font-bold">SELECT PAD TO ASSIGN</span>}
            </div>

            <div className="grid grid-cols-4 gap-2">
                {padConfig.map((sample, index) => (
                    <button
                        key={sample.note}
                        onMouseDown={() => handlePadClick(index)}
                        className={`
                            h-16 rounded-md flex flex-col items-center justify-center transition-all relative overflow-hidden
                            ${activePad === sample.note ? 'brightness-150 scale-95 shadow-inner border-2 border-white' : 'hover:brightness-110'}
                            ${sample.color}
                        `}
                    >
                        <span className="text-xs font-bold z-10">{sample.name}</span>
                        <span className="text-[10px] opacity-50 z-10">{sample.note}</span>
                        {/* Indicator if video is attached */}
                        {sample.videoUrl && <div className="absolute top-1 right-1 w-2 h-2 bg-white rounded-full animate-pulse"></div>}
                        {pendingSample && <div className="absolute inset-0 bg-white/20 hover:bg-white/40 z-20"></div>}
                    </button>
                ))}
            </div>
        </div>
    );
};

// Memoize to avoid re-renders during high-frequency parent updates
export default React.memo(DrumRack);
