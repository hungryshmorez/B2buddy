import { useEffect } from 'react';

type KeyMap = {
    [key: string]: () => void;
};

export const useKeyboardControls = (keyMap: KeyMap) => {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Avoid triggering if user is typing in an input
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
                return;
            }

            // Create key signature (e.g., "Shift+Space" or "Space")
            const parts = [];
            if (event.ctrlKey) parts.push('Ctrl');
            if (event.shiftKey) parts.push('Shift');
            if (event.altKey) parts.push('Alt');

            // Normalize Space to 'Space' instead of ' '
            const key = event.code === 'Space' ? 'Space' : event.key;
            parts.push(key);

            const signature = parts.join('+');

            if (keyMap[signature]) {
                event.preventDefault();
                keyMap[signature]();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [keyMap]);
};
