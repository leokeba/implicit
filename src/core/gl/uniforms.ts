/**
 * Name-keyed uniform binding with cached locations for one linked program.
 * Setters are no-ops for uniforms the program does not use (the compiler
 * strips them, so a null location is normal, not an error). Create a fresh
 * binder whenever the program is (re)linked.
 */
export class UniformBinder {
    private readonly locations = new Map<string, WebGLUniformLocation | null>();

    constructor(
        private readonly gl: WebGLRenderingContext,
        private readonly program: WebGLProgram,
    ) {}

    /** True when the compiled program actually reads this uniform. */
    public has(name: string): boolean {
        return this.location(name) !== null;
    }

    public location(name: string): WebGLUniformLocation | null {
        if (this.locations.has(name)) {
            return this.locations.get(name) ?? null;
        }
        const location = this.gl.getUniformLocation(this.program, name);
        this.locations.set(name, location);
        return location;
    }

    public set1f(name: string, value: number): void {
        const location = this.location(name);
        if (location !== null) {
            this.gl.uniform1f(location, value);
        }
    }

    public set1i(name: string, value: number): void {
        const location = this.location(name);
        if (location !== null) {
            this.gl.uniform1i(location, value);
        }
    }

    public set2f(name: string, x: number, y: number): void {
        const location = this.location(name);
        if (location !== null) {
            this.gl.uniform2f(location, x, y);
        }
    }

    public set3f(name: string, x: number, y: number, z: number): void {
        const location = this.location(name);
        if (location !== null) {
            this.gl.uniform3f(location, x, y, z);
        }
    }
}
