import { useRef, useEffect, useState, useCallback } from 'react';
import * as Tone from 'tone';

export const useAudio = (url: string | null) => {
    const player = useRef<Tone.Player | null>(null);
    const analyser = useRef<Tone.Analyser | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime] = useState(0);

    useEffect(() => {
        if (!url) return;

        const loadAudio = async () => {
            setIsLoaded(false);

            // Create Analyser
            const newAnalyser = new Tone.Analyser('waveform', 256);
            analyser.current = newAnalyser;

            const newPlayer = new Tone.Player({
                url,
                onload: () => {
                    setIsLoaded(true);
                    setDuration(newPlayer.buffer.duration);
                },
                autostart: false,
            }).connect(newAnalyser).toDestination();

            player.current = newPlayer;
        };

        loadAudio();

        return () => {
            player.current?.dispose();
            analyser.current?.dispose();
        };
    }, [url]);

    const play = async () => {
        if (player.current && isLoaded) {
            await Tone.start();
            player.current.start();
            setIsPlaying(true);
        }
    };

    const pause = () => {
        if (player.current && isPlaying) {
            player.current.stop();
            setIsPlaying(false);
        }
    };

    const setPlaybackRate = (rate: number) => {
        if (player.current) {
            player.current.playbackRate = rate;
        }
    };

    const setVolume = (volume: number) => {
        if (player.current) {
            player.current.volume.value = Tone.gainToDb(volume);
        }
    };

    // New method to get real-time data
    const getWaveformData = useCallback(() => {
        if (analyser.current) {
            return analyser.current.getValue();
        }
        return null;
    }, []);

    return {
        isLoaded,
        isPlaying,
        duration,
        currentTime,
        play,
        pause,
        setPlaybackRate,
        setVolume,
        getWaveformData
    };
};
