/// <reference types="vite/client" />

interface Navigator {
    requestMIDIAccess(options?: MIDIOptions): Promise<MIDIAccess>;
}

interface MIDIOptions {
    sysex?: boolean;
    software?: boolean;
}

interface MIDIAccess extends EventTarget {
    readonly inputs: MIDIInputMap;
    readonly outputs: MIDIOutputMap;
    onstatechange: ((this: MIDIAccess, ev: MIDIConnectionEvent) => any) | null;
    readonly sysexEnabled: boolean;
}

interface MIDIInputMap extends Map<string, MIDIInput> {}
interface MIDIOutputMap extends Map<string, MIDIOutput> {}

interface MIDIPort extends EventTarget {
    readonly id: string;
    readonly manufacturer?: string;
    readonly name?: string;
    readonly type: "input" | "output";
    readonly version?: string;
    readonly state: "connected" | "disconnected";
    readonly connection: "open" | "closed" | "pending";
    onstatechange: ((this: MIDIPort, ev: MIDIConnectionEvent) => any) | null;
    open(): Promise<MIDIPort>;
    close(): Promise<MIDIPort>;
}

interface MIDIInput extends MIDIPort {
    onmidimessage: ((this: MIDIInput, ev: MIDIMessageEvent) => any) | null;
}

interface MIDIOutput extends MIDIPort {
    send(data: Iterable<number>, timestamp?: number): void;
    clear(): void;
}

interface MIDIMessageEvent extends Event {
    readonly data: Uint8Array;
    readonly receivedTime: number;
}

interface MIDIConnectionEvent extends Event {
    readonly port: MIDIPort;
}
