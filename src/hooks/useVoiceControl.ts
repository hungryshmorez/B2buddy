import { useState, useEffect, useCallback } from 'react';

type CommandCallback = () => void;

interface Commands {
    [key: string]: CommandCallback;
}

export const useVoiceControl = (commands: Commands) => {
    const [isListening, setIsListening] = useState(false);
    const [lastTranscript, setLastTranscript] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);

    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            const recognitionInstance = new SpeechRecognition();
            recognitionInstance.continuous = true;
            recognitionInstance.interimResults = false;
            recognitionInstance.lang = 'en-US';

            recognitionInstance.onresult = (event: SpeechRecognitionEvent) => {
                const current = event.results[event.results.length - 1];
                if (current.isFinal) {
                    const transcript = current[0].transcript.trim().toLowerCase();
                    setLastTranscript(transcript);
                    processCommand(transcript);
                }
            };

            recognitionInstance.onerror = (event: SpeechRecognitionErrorEvent) => {
                setError(event.error);
                setIsListening(false);
            };

            recognitionInstance.onend = () => {
                setIsListening(false);
            };

            setRecognition(recognitionInstance);
        } else {
            setError("Web Speech API not supported");
        }
    }, []);

    const processCommand = (transcript: string) => {
        console.log("Voice Command:", transcript);

        // Simple heuristic matching
        Object.keys(commands).forEach(cmd => {
            if (transcript.includes(cmd)) {
                commands[cmd]();
            }
        });
    };

    const toggleListening = useCallback(() => {
        if (!recognition) return;

        if (isListening) {
            recognition.stop();
            setIsListening(false);
        } else {
            try {
                recognition.start();
                setIsListening(true);
                setError(null);
            } catch (e) {
                console.error("Failed to start recognition", e);
            }
        }
    }, [isListening, recognition]);

    return { isListening, lastTranscript, error, toggleListening };
};
