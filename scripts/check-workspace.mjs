// Type-checks the scene manifests and postprocess scripts of the workspace
// folder (IMPLICIT_WORKSPACE, from the environment or .env.local) against this
// repo's `implicit/scene` types. The workspace itself stays tool-free: a
// throwaway tsconfig under .tmp/ extends the repo's and pulls the workspace in.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readEnvFile(fileName) {
    const filePath = path.join(repoRoot, fileName);
    if (!existsSync(filePath)) {
        return null;
    }
    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
        const match = /^\s*IMPLICIT_WORKSPACE\s*=\s*(.*?)\s*$/.exec(line);
        if (match) {
            return match[1].replace(/^["']|["']$/g, '');
        }
    }
    return null;
}

const configured = process.env.IMPLICIT_WORKSPACE || readEnvFile('.env.local') || readEnvFile('.env');
if (!configured) {
    console.error('IMPLICIT_WORKSPACE is not set (environment or .env.local); nothing to check.');
    process.exit(1);
}

const workspace = path.resolve(repoRoot, configured);
if (!existsSync(path.join(workspace, 'scenes'))) {
    console.error(`${workspace} has no scenes/ folder.`);
    process.exit(1);
}

const tmpDir = path.join(repoRoot, '.tmp');
mkdirSync(tmpDir, { recursive: true });
const configPath = path.join(tmpDir, 'tsconfig.workspace.json');
writeFileSync(configPath, JSON.stringify({
    extends: '../tsconfig.json',
    compilerOptions: {
        noEmit: true,
        rootDir: commonAncestor(repoRoot, workspace),
    },
    include: [
        path.join(workspace, '**/*.ts'),
        path.join(repoRoot, 'src/scene-runtime/**/*.ts'),
    ],
    exclude: [path.join(workspace, 'node_modules')],
}, null, 2));

console.log(`Checking workspace ${workspace}`);
const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'node_modules/typescript/bin/tsc'), '-p', configPath],
    { stdio: 'inherit' },
);
process.exit(result.status ?? 1);

function commonAncestor(a, b) {
    const left = a.split(path.sep);
    const right = b.split(path.sep);
    const shared = [];
    for (let index = 0; index < Math.min(left.length, right.length) && left[index] === right[index]; index += 1) {
        shared.push(left[index]);
    }
    return shared.join(path.sep) || path.sep;
}
