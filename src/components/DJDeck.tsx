import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import { Play, Pause, Disc, Video, Youtube } from 'lucide-react';
import ReactPlayer from 'react-player';
import { Track } from '../types';
import { useAudio } from '../hooks/useAudio';

export interface DJDeckRef {
    play: () => void;
    pause: () => void;
    togglePlay: () => void;
}

interface DJDeckProps {
    id: number;
    track: Track | null;
    isActive: boolean;
    volume: number;
    onTrackEnd?: () => void;
    onParameterChange: (param: string, value: any) => void;
}

const DJDeck = forwardRef<DJDeckRef, DJDeckProps>(({ id, track, isActive, volume, onParameterChange }, ref) => {

    const isVideo = track?.type === 'video';
    const isYouTube = track?.type === 'youtube';
    const isAudio = track?.type === 'audio' || !track;

    const { isLoaded, isPlaying, play: playAudio, pause: pauseAudio, setPlaybackRate, setVolume, getWaveformData } = useAudio(isAudio ? (track?.url || null) : null);

    const [pitch, setPitch] = useState(0);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const animationRef = useRef<number>();

    const [mediaPlaying, setMediaPlaying] = useState(false);

    const isDeckPlaying = isAudio ? isPlaying : mediaPlaying;

    const isDeckLoaded = isAudio
        ? isLoaded
        : isVideo
            ? !!track?.videoUrl
            : isYouTube
                ? !!track?.youtubeUrl
                : false;

    // --- Imperative Handle ---
    useImperativeHandle(ref, () => ({
        play: () => {
            if (isDeckLoaded) handlePlay();
        },
        pause: () => {
            if (isDeckLoaded) handlePause();
        },
        togglePlay: () => {
            if (isDeckLoaded) handlePlayToggle();
        }
    }));

    // --- Volume Control ---
    useEffect(() => {
        if (isAudio) {
            setVolume(volume);
        } else if (isVideo && videoRef.current) {
            videoRef.current.volume = volume;
        }
    }, [volume, isAudio, isVideo, setVolume]);

    // --- Playback Rate / Pitch Control ---
    useEffect(() => {
        const rate = 1 + (pitch / 100) * 0.08;
        if (isAudio) {
            setPlaybackRate(rate);
        } else if (isVideo && videoRef.current) {
            videoRef.current.playbackRate = rate;
        }
    }, [pitch, isAudio, isVideo, setPlaybackRate]);

    useEffect(() => {
        onParameterChange('playing', isDeckPlaying);
    }, [isDeckPlaying, onParameterChange]);

    // --- Video Element Control ---
    useEffect(() => {
        if (isVideo && videoRef.current) {
            if (mediaPlaying) videoRef.current.play();
            else videoRef.current.pause();
        }
    }, [mediaPlaying, isVideo]);

    // --- Waveform Visualization ---
    useEffect(() => {
        const draw = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const width = canvas.width;
            const height = canvas.height;

            ctx.clearRect(0, 0, width, height);

            if (isAudio) {
                const data = getWaveformData();
                if (data) {
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = isActive ? '#a855f7' : '#6b7280';
                    ctx.beginPath();

                    const sliceWidth = width * 1.0 / data.length;
                    let x = 0;

                    for (let i = 0; i < data.length; i++) {
                        const v = (data[i] as number);
                        const y = (v * height / 2) + height / 2;
                        if (i === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                        x += sliceWidth;
                    }
                    ctx.lineTo(canvas.width, canvas.height / 2);
                    ctx.stroke();
                }
            } else {
                // Placeholder for Video/YouTube
                ctx.fillStyle = "#333";
                ctx.font = "10px sans-serif";
                ctx.fillText(isYouTube ? "YOUTUBE STREAM" : "VIDEO TRACK", 10, height/2);
            }
            animationRef.current = requestAnimationFrame(draw);
        };

        if (isDeckPlaying) {
            draw();
        } else {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        }

        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        };
    }, [isDeckPlaying, getWaveformData, isActive, isAudio, isYouTube]);

    // --- Handlers ---
    const handlePlay = () => {
        if (isVideo || isYouTube) setMediaPlaying(true);
        else playAudio();
    };

    const handlePause = () => {
        if (isVideo || isYouTube) setMediaPlaying(false);
        else pauseAudio();
    };

    const handlePlayToggle = () => {
        if (isDeckPlaying) handlePause();
        else handlePlay();
    };

    const handlePitchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        setPitch(val);
        onParameterChange('pitch', val);
    };

    // Calculate playback rate for props
    const playbackRate = 1 + (pitch / 100) * 0.08;

    return (
        <div className={`bg-gray-800 p-4 rounded-lg border-2 ${isActive ? 'border-purple-500' : 'border-gray-700'} w-full max-w-md shadow-xl relative overflow-hidden`}>

            {/* Background Layer: Video or YouTube */}
            {isVideo && track?.videoUrl && (
                <div className="absolute inset-0 z-0 opacity-30 pointer-events-none">
                    <video
                        ref={videoRef}
                        src={track.videoUrl}
                        loop
                        className="w-full h-full object-cover"
                    />
                </div>
            )}

            {isYouTube && track?.youtubeUrl && (
                <div className="absolute inset-0 z-0 opacity-30 pointer-events-none">
                    <ReactPlayer
                        url={track.youtubeUrl}
                        playing={mediaPlaying}
                        volume={volume}
                        playbackRate={playbackRate}
                        loop={true}
                        width="100%"
                        height="100%"
                        controls={false}
                        className="react-player"
                        config={{
                            youtube: {
                                playerVars: { controls: 0, showinfo: 0, modestbranding: 1 }
                            } as any
                        }}
                    />
                </div>
            )}

            <div className="relative z-10">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-gray-300">Deck {id}</h2>
                    <div className="text-sm text-gray-400 truncate max-w-[150px]">
                        {track ? `${track.artist} - ${track.title}` : 'No Track Loaded'}
                    </div>
                </div>

                {/* Visualizer Area */}
                <div className="relative mb-6">
                    <div className={`w-48 h-48 mx-auto rounded-full border-4 border-gray-600 flex items-center justify-center relative overflow-hidden ${isDeckPlaying ? 'animate-spin-slow' : ''}`}>
                        {isVideo ? <Video size={80} className="text-blue-500" /> :
                         isYouTube ? <Youtube size={80} className="text-red-500" /> :
                         <Disc size={120} className="text-gray-500" />}
                    </div>
                    {/* Overlay Waveform Canvas */}
                    <canvas
                        ref={canvasRef}
                        width={300}
                        height={60}
                        className="absolute bottom-0 left-1/2 transform -translate-x-1/2 bg-black/50 rounded backdrop-blur-sm"
                    />
                </div>

                {/* Controls */}
                <div className="flex flex-col gap-4">
                    <div className="flex justify-center gap-4">
                        <button
                            onClick={handlePlayToggle}
                            disabled={!isDeckLoaded}
                            className={`p-4 rounded-full ${isDeckPlaying ? 'bg-green-500 shadow-lg shadow-green-500/50' : 'bg-gray-600'} hover:opacity-80 transition-all`}
                        >
                            {isDeckPlaying ? <Pause size={24} /> : <Play size={24} />}
                        </button>
                    </div>

                    <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-gray-500">PITCH</span>
                        <input
                            type="range"
                            min="-100"
                            max="100"
                            value={pitch}
                            onChange={handlePitchChange}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                        />
                        <span className="text-xs w-8 text-right font-mono text-gray-300">{pitch > 0 ? '+' : ''}{pitch}%</span>
                    </div>

                    <div className="text-center text-sm font-mono text-purple-400 bg-purple-900/20 py-1 rounded">
                        {track ? `${track.bpm} BPM` : '-- BPM'}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default DJDeck;
