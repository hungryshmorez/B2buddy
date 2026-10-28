import { useEffect, useState } from 'react';

export const useMIDI = () => {
    const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);
    const [inputs, setInputs] = useState<MIDIInput[]>([]);

    // Simple state to expose the last MIDI message for debugging or mapping
    const [lastMessage, setLastMessage] = useState<{
        source: string;
        data: Uint8Array;
        timestamp: number;
    } | null>(null);

    useEffect(() => {
        if (navigator.requestMIDIAccess) {
            navigator.requestMIDIAccess()
                .then(onMIDISuccess, onMIDIFailure);
        } else {
            console.warn('Web MIDI API not supported in this browser.');
        }
    }, []);

    function onMIDISuccess(access: MIDIAccess) {
        setMidiAccess(access);
        updateInputs(access);

        access.onstatechange = (e) => {
             // Refresh inputs if devices change
             // @ts-ignore
             if (e.port.type === 'input') {
                 updateInputs(access);
             }
        };
    }

    function updateInputs(access: MIDIAccess) {
        const inputsArr: MIDIInput[] = [];
        access.inputs.forEach((input) => {
            inputsArr.push(input);
            input.onmidimessage = getMIDIMessage;
        });
        setInputs(inputsArr);
    }

    function onMIDIFailure() {
        console.error('Could not access your MIDI devices.');
    }

    function getMIDIMessage(message: MIDIMessageEvent) {
        const command = message.data![0];
        const note = message.data![1];
        const velocity = (message.data!.length > 2) ? message.data![2] : 0;

        setLastMessage({
            // @ts-ignore
            source: message.target?.name || 'Unknown',
            data: message.data!,
            timestamp: message.timeStamp
        });

        // Here you would dispatch global events or call a callback passed to the hook
        // to control the app. For now, we just expose the message.
        console.log(`MIDI: Command:${command} Note:${note} Velocity:${velocity}`);
    }

    return {
        inputs,
        lastMessage,
        midiAccess
    };
};
