import { useState, useEffect, useRef, useCallback } from 'react';
import { Layout, BarChart2, Radio, Swords, Mic } from 'lucide-react';
import DJDeck, { DJDeckRef } from './components/DJDeck';
import Mixer from './components/Mixer';
import Library from './components/Library';
import DrumRack from './components/DrumRack';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import BattleArena from './components/BattleArena';
import MobileNav from './components/MobileNav';
import MasterVideoOutput from './components/MasterVideoOutput';
import { Track, ChannelState } from './types';
import { aiService } from './services/AILearningService';
import { aiB2BService, AIAction } from './services/AIB2BService';
import { battleService } from './services/BattleService';
import { useMIDI } from './hooks/useMIDI';
import { useKeyboardControls } from './hooks/useKeyboardControls';
import { useVoiceControl } from './hooks/useVoiceControl';

function App() {
  const deckARef = useRef<DJDeckRef>(null);
  const deckBRef = useRef<DJDeckRef>(null);

  const [view, setView] = useState<'studio' | 'library' | 'battle' | 'analytics'>('studio');
  const [deckATrack, setDeckATrack] = useState<Track | null>(null);
  const [deckBTrack, setDeckBTrack] = useState<Track | null>(null);
  const [isB2BActive, setIsB2BActive] = useState(false);

  // Mixer State
  const [crossfader, setCrossfader] = useState(0);

  // 4 Channel State: A Audio, A Video, B Audio, B Video
  const [channels, setChannels] = useState<[ChannelState, ChannelState, ChannelState, ChannelState]>([
      { volume: 1, high: 0, mid: 0, low: 0 }, // Ch1: Deck A Audio
      { volume: 1, high: 0, mid: 0, low: 0 }, // Ch2: Deck A Video (Opacity)
      { volume: 1, high: 0, mid: 0, low: 0 }, // Ch3: Deck B Audio
      { volume: 1, high: 0, mid: 0, low: 0 }, // Ch4: Deck B Video (Opacity)
  ]);

  // Sync State for VJ
  const [deckAPlaying, setDeckAPlaying] = useState(false);
  const [deckBPlaying, setDeckBPlaying] = useState(false);

  const [pendingSample, setPendingSample] = useState<{url: string, name: string} | null>(null);
  const [activeDrumVideo, setActiveDrumVideo] = useState<string | null>(null);
  const [activeVJEFFECT, setActiveVJEFFECT] = useState<'datamosh' | 'pixelsort' | 'feedback' | 'colorshift' | 'none'>('none');

  const { lastMessage } = useMIDI();

  // --- Volume Calculation ---
  // Calculates the effective volume for a deck based on its Channel Fader AND Crossfader
  const calculateEffectiveVolume = (channelIndex: number, isDeckB: boolean) => {
      const channelVol = channels[channelIndex].volume;
      let crossfaderGain = 1;

      if (!isDeckB) { // Deck A
          crossfaderGain = crossfader <= 0 ? 1 : 1 - crossfader;
      } else { // Deck B
          crossfaderGain = crossfader >= 0 ? 1 : 1 + crossfader;
      }

      return channelVol * crossfaderGain;
  };

  const deckAVolume = calculateEffectiveVolume(0, false);
  const deckBVolume = calculateEffectiveVolume(2, true);

  // --- Handlers ---

  const handleCrossfaderChange = (val: number) => {
    setCrossfader(Math.max(-1, Math.min(1, val)));
    aiService.logInteraction('fader', 'crossfader', val);
  };

  const handleChannelStateChange = (index: number, newState: Partial<ChannelState>) => {
      const newChannels = [...channels] as [ChannelState, ChannelState, ChannelState, ChannelState];
      newChannels[index] = { ...newChannels[index], ...newState };
      setChannels(newChannels);

      if (newState.volume !== undefined) {
          aiService.logInteraction('fader', `ch_${index}_vol`, newState.volume);
      }
  };

  const toggleDeckPlay = (deckId: number) => {
      if (deckId === 0 && deckARef.current) {
          deckARef.current.togglePlay();
      } else if (deckId === 1 && deckBRef.current) {
          deckBRef.current.togglePlay();
      }
  };

  const handleAIAction = (action: AIAction) => {
      if (action.type === 'LOAD_TRACK' && action.deckId !== undefined) {
          if (action.deckId === 1) setDeckBTrack(action.payload);
          else setDeckATrack(action.payload);
      } else if (action.type === 'CROSSFADER' && action.value !== undefined) {
          setCrossfader(action.value);
      }
  };

  const toggleB2B = () => {
      if (isB2BActive) {
          aiB2BService.stopB2B();
          setIsB2BActive(false);
      } else {
          aiB2BService.startB2B(handleAIAction);
          setIsB2BActive(true);
      }
  };

  // Memoized to prevent re-renders of DrumRack
  const handleTriggerDrumVideo = useCallback((url: string) => {
      setActiveDrumVideo(url);
  }, []);

  const toggleVJEffect = () => {
      const effects = ['none', 'datamosh', 'pixelsort', 'feedback', 'colorshift'] as const;
      const next = effects[(effects.indexOf(activeVJEFFECT) + 1) % effects.length];
      setActiveVJEFFECT(next);
  };

  // --- Controls ---

  useKeyboardControls({
      'ArrowLeft': () => handleCrossfaderChange(crossfader - 0.1),
      'ArrowRight': () => handleCrossfaderChange(crossfader + 0.1),
      'c': () => handleCrossfaderChange(0),
      'Space': () => toggleDeckPlay(0),
      'Shift+Space': () => toggleDeckPlay(1),
  });

  const { isListening, toggleListening, lastTranscript } = useVoiceControl({
      'play deck one': () => toggleDeckPlay(0),
      'stop deck one': () => toggleDeckPlay(0),
      'play deck two': () => toggleDeckPlay(1),
      'stop deck two': () => toggleDeckPlay(1),
      'crossfade left': () => handleCrossfaderChange(-1),
      'crossfade right': () => handleCrossfaderChange(1),
      'center': () => handleCrossfaderChange(0),
      'start battle': () => setView('battle'),
      'studio mode': () => setView('studio'),
  });

  // --- Effects ---

  useEffect(() => {
    if (lastMessage) {
       if (lastMessage.data[0] === 176 && lastMessage.data[1] === 1) {
          const normalized = (lastMessage.data[2] / 127) * 2 - 1;
          handleCrossfaderChange(normalized);
       }
    }
  }, [lastMessage]);

  // Memoized to maintain stable references for Library component
  const handleLoadTrack = useCallback((track: Track, deckId: number) => {
    if (deckId === 0) {
        setDeckATrack(track);
        if (view === 'battle') {
            battleService.submitPlayerTurn(track);
        }
    }
    else {
        setDeckBTrack(track);
    }
    aiService.logInteraction('load_track', `deck_${deckId}`, track.id);
  }, [view]);

  const handleLoadSample = useCallback((url: string, name: string) => { setPendingSample({ url, name }); }, []);
  const handleSampleAssigned = useCallback(() => { setPendingSample(null); }, []);

  const handleDeckParamChange = (deckId: number, param: string, value: any) => {
      if (param === 'playing') {
          if (deckId === 0) setDeckAPlaying(!!value);
          else setDeckBPlaying(!!value);
      }
      aiService.logInteraction('play_pause', `deck_${deckId}_${param}`, value);
  };

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col md:flex-row overflow-hidden font-sans relative">

      {/* Master Video Output Background */}
      <MasterVideoOutput
          channels={channels}
          deckAVideo={deckATrack?.videoUrl}
          deckBVideo={deckBTrack?.videoUrl}
          deckAPlaying={deckAPlaying}
          deckBPlaying={deckBPlaying}
          drumVideoClip={activeDrumVideo}
          activeEffect={activeVJEFFECT}
      />

      <div className="hidden md:block h-full border-r border-gray-700 bg-gray-900/90 backdrop-blur-md relative z-10">
          {view === 'battle' ? (
              <BattleArena />
          ) : (
              <Library onLoadTrack={handleLoadTrack} onLoadSample={handleLoadSample} />
          )}
      </div>

      <div className="flex-1 flex flex-col h-full relative z-10">
        <div className="hidden md:flex h-16 bg-gray-800/90 border-b border-gray-700 justify-between items-center px-6 shrink-0 backdrop-blur-md">
          <div className="flex items-center gap-3">
             <div className="bg-purple-600 p-2 rounded-lg shadow-lg shadow-purple-900/50">
                <Layout size={24} className="text-white" />
             </div>
             <div>
                <h1 className="text-xl font-bold leading-none">B2Buddy <span className="text-purple-400">AI Arena</span></h1>
                <div className="text-[10px] text-gray-400 uppercase tracking-widest">
                    {lastMessage ? <span className="text-green-400">MIDI ACTIVE</span> : <span>NO MIDI</span>}
                </div>
             </div>
          </div>

          <div className="flex bg-gray-900/50 rounded-lg p-1 border border-gray-700">
              <button onClick={() => setView('studio')} className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${view === 'studio' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}><Layout size={16} /> Studio</button>
              <button onClick={() => setView('battle')} className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${view === 'battle' ? 'bg-red-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}><Swords size={16} /> Battle</button>
              <button onClick={() => setView('analytics')} className={`px-4 py-2 rounded-md text-sm font-bold flex items-center gap-2 transition-all ${view === 'analytics' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}><BarChart2 size={16} /> Analytics</button>
          </div>

          <div className="flex items-center gap-2">
              <button
                onClick={toggleVJEffect}
                className="bg-black/50 hover:bg-purple-900/80 text-white text-xs px-2 py-1 rounded border border-purple-500 backdrop-blur-md"
              >
                  FX: {activeVJEFFECT.toUpperCase()}
              </button>
              <button
                onClick={toggleListening}
                className={`p-2 rounded-full transition-all relative ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-700 text-gray-300 hover:text-white'}`}
                title={lastTranscript || "Toggle Voice Control"}
              >
                  <Mic size={18} />
                  {isListening && <span className="absolute -top-1 -right-1 w-2 h-2 bg-white rounded-full"></span>}
              </button>
              <button
                 onClick={toggleB2B}
                 className={`px-4 py-2 rounded-full font-bold text-sm flex items-center gap-2 border transition-all ${isB2BActive ? 'bg-red-500 border-red-400 text-white animate-pulse' : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'}`}
              >
                  <Radio size={16} /> {isB2BActive ? 'STOP B2B' : 'START B2B'}
              </button>
          </div>
        </div>

        <div className="md:hidden h-14 bg-gray-800/90 border-b border-gray-700 flex justify-between items-center px-4 shrink-0 backdrop-blur-md">
            <h1 className="text-lg font-bold">B2Buddy</h1>
             <div className="flex gap-2">
                 <button onClick={toggleListening} className={`p-2 rounded-full ${isListening ? 'bg-red-500 text-white' : 'bg-gray-700 text-gray-300'}`}><Mic size={16} /></button>
                 <button onClick={toggleB2B} className={`px-3 py-1 rounded-full text-xs font-bold border ${isB2BActive ? 'bg-red-500 border-red-400' : 'bg-gray-700 border-gray-600'}`}>
                     {isB2BActive ? 'B2B ON' : 'B2B OFF'}
                 </button>
             </div>
        </div>

        <div className="flex-1 overflow-hidden relative pb-16 md:pb-0">
            {view === 'library' && <div className="h-full bg-gray-900"><Library onLoadTrack={handleLoadTrack} onLoadSample={handleLoadSample} /></div>}

            <div className={`h-full overflow-y-auto ${view === 'studio' ? 'block' : 'hidden'}`}>
                <div className="flex flex-col md:flex-row justify-center items-center md:items-start gap-6 p-4 md:p-6">
                    <DJDeck
                        id={1}
                        ref={deckARef}
                        track={deckATrack}
                        isActive={crossfader < 0.5}
                        volume={deckAVolume}
                        onParameterChange={(p, v) => handleDeckParamChange(0, p, v)}
                    />
                    <div className="order-last md:order-none w-full md:w-auto flex justify-center">
                        <Mixer
                            crossfader={crossfader}
                            setCrossfader={handleCrossfaderChange}
                            channels={channels}
                            setChannelState={handleChannelStateChange}
                        />
                    </div>
                    <DJDeck
                        id={2}
                        ref={deckBRef}
                        track={deckBTrack}
                        isActive={crossfader > -0.5}
                        volume={deckBVolume}
                        onParameterChange={(p, v) => handleDeckParamChange(1, p, v)}
                    />
                </div>
                <div className="flex flex-col md:flex-row gap-6 p-4 md:px-6 md:pb-6">
                    <div className="flex-1">
                        <DrumRack
                            pendingSample={pendingSample}
                            onSampleAssigned={handleSampleAssigned}
                            onTriggerVideo={handleTriggerDrumVideo}
                        />
                    </div>
                    <div className="w-full md:w-80 bg-gray-800/80 p-4 rounded-lg border border-gray-700 backdrop-blur-sm">
                        <h3 className="text-gray-400 font-bold mb-3 uppercase text-xs tracking-wider">AI B2B Partner</h3>
                        <div className="text-sm text-gray-300 space-y-2">
                            <div className="flex justify-between"><span>Status</span><span className={isB2BActive ? "text-green-400" : "text-gray-500"}>{isB2BActive ? "ACTIVE" : "STANDBY"}</span></div>
                            <div className="w-full bg-gray-700 h-2 rounded-full overflow-hidden"><div className={`w-2/3 h-full ${isB2BActive ? "bg-purple-500 animate-pulse" : "bg-gray-600"}`}></div></div>
                            <p className="text-xs text-gray-500">{isB2BActive ? "AI is listening and preparing next track..." : "Waiting for session start."}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className={`h-full overflow-y-auto ${view === 'battle' ? 'block' : 'hidden'}`}>
                <div className="md:hidden h-full"><BattleArena /></div>
                <div className="hidden md:block h-full">
                     <div className="flex flex-col md:flex-row justify-center items-center md:items-start gap-6 p-4 md:p-6">
                        <DJDeck id={1} track={deckATrack} isActive={crossfader < 0.5} volume={deckAVolume} onParameterChange={(p, v) => handleDeckParamChange(0, p, v)} />
                        <div className="order-last md:order-none w-full md:w-auto flex justify-center">
                            <Mixer
                                crossfader={crossfader}
                                setCrossfader={handleCrossfaderChange}
                                channels={channels}
                                setChannelState={handleChannelStateChange}
                            />
                        </div>
                        <DJDeck id={2} track={deckBTrack} isActive={crossfader > -0.5} volume={deckBVolume} onParameterChange={(p, v) => handleDeckParamChange(1, p, v)} />
                    </div>
                </div>
            </div>

            <div className={`h-full overflow-y-auto ${view === 'analytics' ? 'block' : 'hidden'}`}>
                <div className="h-full p-4 md:p-6 bg-gray-900"><AnalyticsDashboard /></div>
            </div>
        </div>

        <MobileNav activeTab={view} onTabChange={setView} />
      </div>
    </div>
  );
}

export default App;
