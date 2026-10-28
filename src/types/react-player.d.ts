declare module 'react-player' {
    import React from 'react';

    export interface ReactPlayerProps {
        url?: string | string[] | MediaStream;
        playing?: boolean;
        loop?: boolean;
        controls?: boolean;
        light?: boolean | string;
        volume?: number;
        muted?: boolean;
        playbackRate?: number;
        width?: string | number;
        height?: string | number;
        style?: React.CSSProperties;
        progressInterval?: number;
        playsinline?: boolean;
        pip?: boolean;
        stopOnUnmount?: boolean;
        fallback?: React.ReactElement;
        wrapper?: any;
        playIcon?: React.ReactElement;
        previewTabIndex?: number;
        config?: any;
        onReady?: (player: ReactPlayer) => void;
        onStart?: () => void;
        onPlay?: () => void;
        onPause?: () => void;
        onBuffer?: () => void;
        onBufferEnd?: () => void;
        onEnded?: () => void;
        onError?: (error: any, data?: any, hlsInstance?: any, hlsGlobal?: any) => void;
        onDuration?: (duration: number) => void;
        onSeek?: (seconds: number) => void;
        onProgress?: (state: { played: number; playedSeconds: number; loaded: number; loadedSeconds: number }) => void;
        onClickPreview?: (event: any) => void;
        onEnablePIP?: () => void;
        onDisablePIP?: () => void;
        className?: string;
    }

    export default class ReactPlayer extends React.Component<ReactPlayerProps, any> {
        seekTo(amount: number, type?: 'seconds' | 'fraction'): void;
        getCurrentTime(): number;
        getDuration(): number;
        getInternalPlayer(key?: string): any;
    }
}
