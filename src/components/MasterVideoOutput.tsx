import React, { useRef, useEffect } from 'react';
import ReactPlayer from 'react-player';
import { ChannelState } from '../types';
import VJRenderer, { VJRendererRef } from './VJRenderer';

interface MasterVideoOutputProps {
    channels: [ChannelState, ChannelState, ChannelState, ChannelState];
    deckAVideo?: string;
    deckBVideo?: string;
    deckAPlaying: boolean;
    deckBPlaying: boolean;
    drumVideoClip?: string | null;
    activeEffect: 'datamosh' | 'pixelsort' | 'feedback' | 'colorshift' | 'none';
}

const MasterVideoOutput: React.FC<MasterVideoOutputProps> = ({ channels, deckAVideo, deckBVideo, deckAPlaying, deckBPlaying, drumVideoClip, activeEffect }) => {
    // Channel 1 = Deck A Video
    // Channel 3 = Deck B Video
    const chA = channels[1];
    const chB = channels[3];

    // Detect if sources are YouTube
    // Simple heuristic: Does it contain youtube.com or youtu.be?
    const isYouTubeA = deckAVideo && (deckAVideo.includes('youtube.com') || deckAVideo.includes('youtu.be'));
    const isYouTubeB = deckBVideo && (deckBVideo.includes('youtube.com') || deckBVideo.includes('youtu.be'));

    // Refs to invisible video elements for WebGL consumption
    const videoARef = useRef<HTMLVideoElement>(null);
    const videoBRef = useRef<HTMLVideoElement>(null);
    const rendererRef = useRef<VJRendererRef>(null);

    // Logic for Video Elements (Native)
    useEffect(() => {
        if (!isYouTubeA && videoARef.current) {
            if (deckAVideo) {
                if (videoARef.current.src !== deckAVideo) {
                    videoARef.current.src = deckAVideo;
                }
                if (deckAPlaying) {
                    videoARef.current.play().catch(e => console.warn('VJ A play failed', e));
                } else {
                    videoARef.current.pause();
                }
            } else {
                videoARef.current.pause();
            }
        }
    }, [deckAVideo, isYouTubeA, deckAPlaying]);

    useEffect(() => {
        if (!isYouTubeB && videoBRef.current) {
            if (deckBVideo) {
                if (videoBRef.current.src !== deckBVideo) {
                    videoBRef.current.src = deckBVideo;
                }
                if (deckBPlaying) {
                    videoBRef.current.play().catch(e => console.warn('VJ B play failed', e));
                } else {
                    videoBRef.current.pause();
                }
            } else {
                videoBRef.current.pause();
            }
        }
    }, [deckBVideo, isYouTubeB, deckBPlaying]);

    useEffect(() => {
        if (rendererRef.current) {
            rendererRef.current.setEffect(activeEffect);
        }
    }, [activeEffect]);

    const getBlendMode = (mid: number): string => {
        if (mid > 6) return 'screen';
        if (mid < -6) return 'multiply';
        return 'normal';
    };

    // Helper for CSS filters (Used for YouTube layers which bypass WebGL)
    const getCssFilter = (high: number, mid: number, low: number) => {
        const hueRotate = high * 15;
        const saturate = Math.max(0, 1 + (high / 12));
        const contrast = Math.max(0, 1 + (mid / 12));
        const brightness = Math.max(0, 1 + (mid / 24));
        const opacity = Math.max(0, 1 + (low / 12));
        return `hue-rotate(${hueRotate}deg) saturate(${saturate}) contrast(${contrast}) brightness(${brightness}) opacity(${opacity})`;
    };

    return (
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden bg-black">

            {/* Native Video Sources (Hidden, fed to WebGL) */}
            {!isYouTubeA && <video ref={videoARef} className="hidden" muted loop playsInline />}
            {!isYouTubeB && <video ref={videoBRef} className="hidden" muted loop playsInline />}

            {/* WebGL Renderer (For native video files) */}
            <div className="absolute inset-0 w-full h-full z-0">
                <VJRenderer
                    ref={rendererRef}
                    videoSourceA={isYouTubeA ? null : videoARef.current}
                    videoSourceB={isYouTubeB ? null : videoBRef.current}
                    opacityA={chA.volume}
                    opacityB={chB.volume}
                    mixBlendModeB={getBlendMode(chB.mid)}
                />
            </div>

            {/* YouTube Layers (Overlay on top of WebGL canvas if active) */}
            {/* Deck A YouTube */}
            {isYouTubeA && deckAVideo && (
                <div
                    className="absolute inset-0 w-full h-full z-10 pointer-events-none"
                    style={{
                        opacity: chA.volume,
                        filter: getCssFilter(chA.high, chA.mid, chA.low)
                    }}
                >
                    <ReactPlayer
                        url={deckAVideo}
                        playing={deckAPlaying}
                        loop={true}
                        muted={true} // Audio handled by Deck component player
                        width="100%"
                        height="100%"
                        controls={false}
                        config={{ youtube: { playerVars: { controls: 0, showinfo: 0, modestbranding: 1 } } as any }}
                    />
                </div>
            )}

            {/* Deck B YouTube */}
            {isYouTubeB && deckBVideo && (
                <div
                    className="absolute inset-0 w-full h-full z-10 pointer-events-none"
                    style={{
                        opacity: chB.volume,
                        filter: getCssFilter(chB.high, chB.mid, chB.low),
                        mixBlendMode: getBlendMode(chB.mid) as any
                    }}
                >
                    <ReactPlayer
                        url={deckBVideo}
                        playing={deckBPlaying}
                        loop={true}
                        muted={true}
                        width="100%"
                        height="100%"
                        controls={false}
                        config={{ youtube: { playerVars: { controls: 0, showinfo: 0, modestbranding: 1 } } as any }}
                    />
                </div>
            )}

            {/* Drum Video Clip Overlay */}
            {drumVideoClip && (
                <div className="absolute inset-0 w-full h-full z-20 mix-blend-lighten flex items-center justify-center">
                    <video
                        key={drumVideoClip}
                        src={drumVideoClip}
                        autoPlay
                        muted
                        onEnded={(e) => (e.target as HTMLVideoElement).style.opacity = '0'}
                        className="w-full h-full object-cover animate-pulse-fast"
                    />
                </div>
            )}

            {/* Fallback */}
            {(!deckAVideo && !deckBVideo && !drumVideoClip && activeEffect === 'none') && (
                <div className="flex items-center justify-center h-full opacity-10">
                    <span className="text-6xl font-bold text-gray-800">MASTER OUTPUT</span>
                </div>
            )}
        </div>
    );
};

export default MasterVideoOutput;
