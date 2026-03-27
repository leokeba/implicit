declare module '*.glsl?raw' {
    const source: string;
    export default source;
}

interface ImportMeta {
    glob(pattern: string, options?: Record<string, unknown>): Record<string, unknown>;
    globEager(pattern: string): Record<string, unknown>;
}
