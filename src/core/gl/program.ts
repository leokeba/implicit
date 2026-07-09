/**
 * Shared WebGL program compilation for the renderer and the slicer's GPU
 * field sampler: compile errors carry a source excerpt around the failing
 * line, and no shader or program object leaks on any failure path.
 */

export function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) {
        throw new Error('Failed to create shader object.');
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const infoLog = gl.getShaderInfoLog(shader) || 'Unknown shader compile error';
        gl.deleteShader(shader);

        const stage = type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment';
        const lineNumber = parseShaderErrorLine(infoLog);
        const sceneLocation = describeSceneSourceLine(source, lineNumber);
        const excerpt = buildShaderSourceExcerpt(source, lineNumber);

        throw new Error(
            [
                `${stage} shader compile error`,
                sceneLocation,
                infoLog,
                excerpt,
            ].filter((part) => part.length > 0).join('\n\n')
        );
    }

    return shader;
}

/**
 * Maps a composed-source line back to the author's scene.glsl using the
 * `__SCENE_GLSL_BEGIN__`/`__SCENE_GLSL_END__` markers the shader pipeline
 * injects around the scene chunk. Empty string when the line falls outside
 * the scene chunk (or no markers are present).
 */
function describeSceneSourceLine(source: string, lineNumber: number | null): string {
    if (lineNumber === null) {
        return '';
    }

    const lines = source.split(/\r?\n/);
    const beginIndex = lines.findIndex((line) => line.includes('__SCENE_GLSL_BEGIN__'));
    if (beginIndex === -1) {
        return '';
    }
    let endIndex = lines.findIndex((line) => line.includes('__SCENE_GLSL_END__'));
    if (endIndex === -1) {
        endIndex = lines.length;
    }

    // Marker lines are 1-based beginIndex+1 and endIndex+1; scene.glsl line 1
    // is the composed line right after the begin marker.
    const sceneLine = lineNumber - (beginIndex + 1);
    if (sceneLine < 1 || lineNumber > endIndex) {
        return '';
    }

    return `In scene.glsl at line ${sceneLine}`;
}

export function createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    let fragmentShader: WebGLShader;
    try {
        fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    } catch (error) {
        gl.deleteShader(vertexShader);
        throw error;
    }

    const program = gl.createProgram();
    if (!program) {
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        throw new Error('Failed to create shader program.');
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const error = gl.getProgramInfoLog(program) || 'Unknown program link error';
        gl.deleteProgram(program);
        throw new Error(`Program link error\n\n${error}`);
    }

    return program;
}

function parseShaderErrorLine(infoLog: string): number | null {
    const match = infoLog.match(/\b\d+:(\d+)\b/);
    if (!match?.[1]) {
        return null;
    }

    const parsed = Number.parseInt(match[1], 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return null;
    }

    return parsed;
}

function buildShaderSourceExcerpt(source: string, lineNumber: number | null): string {
    if (lineNumber === null) {
        return '';
    }

    const lines = source.split(/\r?\n/);
    if (lineNumber > lines.length) {
        return '';
    }

    const contextRadius = 2;
    const start = Math.max(1, lineNumber - contextRadius);
    const end = Math.min(lines.length, lineNumber + contextRadius);
    const width = String(end).length;

    const excerptLines: string[] = [];
    excerptLines.push(`Source excerpt around line ${lineNumber}:`);

    for (let line = start; line <= end; line += 1) {
        const marker = line === lineNumber ? '>' : ' ';
        const label = String(line).padStart(width, ' ');
        excerptLines.push(`${marker} ${label} | ${lines[line - 1]}`);
    }

    return excerptLines.join('\n');
}
