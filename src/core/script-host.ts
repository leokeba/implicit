import ts from 'typescript';

export type ModuleRequire = (specifier: string) => unknown;

export interface EvaluateModuleOptions {
    source: string;
    /** Used for transpile diagnostics and error messages, e.g. 'lamp_shade/scene.ts'. */
    fileName: string;
    /** Resolves import specifiers ('implicit/scene', './helper'). Throws on unknown specifiers. */
    require?: ModuleRequire;
    /**
     * Cache key for the evaluated exports. Must cover every input that affects
     * the result, including sources reachable through `require`. Omit to
     * disable caching.
     */
    cacheKey?: string;
}

const moduleExportsCache = new Map<string, Record<string, unknown>>();

/**
 * Compiles a user-authored TS/JS module to CommonJS and evaluates it.
 * Throws with readable messages on compile or runtime failure.
 */
export function evaluateUserModule(options: EvaluateModuleOptions): Record<string, unknown> {
    const cached = options.cacheKey ? moduleExportsCache.get(options.cacheKey) : undefined;
    if (cached) {
        return cached;
    }

    const compiledSource = transpileUserModule(options.source, options.fileName);
    const moduleRef: { exports: Record<string, unknown> } = { exports: {} };
    const requireShim: ModuleRequire = options.require ?? ((specifier: string) => {
        throw new Error(`'${options.fileName}' cannot import '${specifier}': imports are not available here.`);
    });

    const factory = new Function('module', 'exports', 'require', compiledSource) as (
        module: { exports: Record<string, unknown> },
        exports: Record<string, unknown>,
        require: ModuleRequire,
    ) => void;
    factory(moduleRef, moduleRef.exports, requireShim);

    if (options.cacheKey) {
        moduleExportsCache.set(options.cacheKey, moduleRef.exports);
    }

    return moduleRef.exports;
}

export function transpileUserModule(source: string, fileName: string): string {
    const result = ts.transpileModule(source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.CommonJS,
            allowJs: true,
            useDefineForClassFields: false,
        },
        fileName,
        reportDiagnostics: true,
    });

    const diagnostics = result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
    if (diagnostics.length > 0) {
        const message = diagnostics
            .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
            .join('\n');
        throw new Error(`'${fileName}' failed to compile.\n${message}`);
    }

    return result.outputText;
}

export function hashString(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16).padStart(8, '0');
}
