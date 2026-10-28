import { lazy, Suspense, useState } from 'react';
import Arena from './Arena';
import { Credits, Gate, Library, Menu, Screen, Settings, Setup, Training } from './Screens';
import { useRuntime } from './useRuntime';
import './game.css';

const Studio = lazy(() => import('../../App'));

export default function GameApp() {
    const rt = useRuntime(); const [screen, setScreen] = useState<Screen>(rt.ready ? 'menu' : 'gate');
    const go = (s: Screen) => { if (s === 'menu') rt.leave(); setScreen(s); };
    // the arena screen follows the runtime mode, so leaving from the results dialog or MIDI returns to the menu
    const effective: Screen = screen === 'arena' && rt.mode === 'menu' ? 'menu' : screen;
    return (
        <div className="gapp">
            {effective === 'gate' && <Gate rt={rt} onStart={() => setScreen('menu')} />}
            {effective === 'menu' && <Menu rt={rt} go={s => { if (s === 'arena') setScreen('arena'); else go(s); }} />}
            {effective === 'setup' && <Setup rt={rt} go={s => setScreen(s)} />}
            {effective === 'arena' && <Arena rt={rt} onExit={() => setScreen('menu')} />}
            {effective === 'library' && <Library rt={rt} go={go} />}
            {effective === 'training' && <Training rt={rt} go={go} />}
            {effective === 'settings' && <Settings rt={rt} go={go} />}
            {effective === 'credits' && <Credits go={go} />}
            {effective === 'studio' && <Suspense fallback={<div className="gscreen center">Loading studio…</div>}><button className="gback" onClick={() => setScreen('menu')}>← GAME MENU</button><Studio /></Suspense>}
        </div>);
}
