import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const WORKSPACE_API = '/__implicit_api/workspace';
const SCENE_API_PREFIX = '/__implicit_api/scenes';
const POSTPROCESS_API_PREFIX = '/__implicit_api/postprocess-scripts';
const SCENE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const SCENE_FILE_PATTERN = /^[a-z0-9][a-z0-9 _.()-]*\.(glsl|ts|js)$/i;
const POSTPROCESS_FILE_PATTERN = /^[a-z0-9][a-z0-9 _.()-]*\.(js|ts)$/i;
const PRESET_FILE_PATTERN = /^[a-z0-9][a-z0-9 _.()-]*\.json$/i;
const codeMirrorPackages = [
  'svelte-codemirror-editor',
  'codemirror',
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/language',
  '@codemirror/lang-cpp',
  '@codemirror/theme-one-dark',
];

interface SceneApiBundle {
  id: string;
  files: Record<string, string>;
}

interface WorkspaceApiFile {
  fileName: string;
  source: string;
}

/**
 * The folder the in-app editors read and write: scenes/, postprocess-scripts/,
 * printers/ and filaments/ under one root. IMPLICIT_WORKSPACE (env or
 * .env.local) points it at a private designs checkout; unset, it is this
 * repo's src/, i.e. the bundled defaults themselves.
 */
interface WorkspaceRoot {
  dir: string;
  label: string;
}

function resolveWorkspaceRoot(mode: string): WorkspaceRoot {
  const env = loadEnv(mode, process.cwd(), '');
  const configured = env.IMPLICIT_WORKSPACE?.trim();
  if (!configured) {
    return { dir: path.resolve('src'), label: 'src' };
  }
  const dir = path.resolve(configured);
  return { dir, label: path.basename(dir) };
}

function createWorkspaceFilesApiPlugin(workspace: WorkspaceRoot): Plugin {
  const middleware = createWorkspaceFilesApiMiddleware(workspace);

  return {
    name: 'implicit-workspace-files-api',
    // Workspace sources reach the running app through this file API: the app
    // polls it and hot-applies edits in place (recompiling shaders without
    // losing camera, fullscreen, or the WebGL context). The `?raw` glob
    // imports of src/ only exist for bundled builds, so when the workspace is
    // src/ itself suppress Vite's own HMR reaction to them — otherwise every
    // IDE edit invalidates an unaccepted raw module and forces a full reload.
    hotUpdate({ file }) {
      if (path.normalize(file).startsWith(workspace.dir + path.sep)) {
        return [];
      }
    },
    configureServer(server) {
      server.config.logger.info(`  ➜  workspace: ${workspace.dir}`);
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function createWorkspaceFilesApiMiddleware(workspace: WorkspaceRoot): Connect.NextHandleFunction {
  const scenesDirectory = path.join(workspace.dir, 'scenes');
  const postprocessDirectory = path.join(workspace.dir, 'postprocess-scripts');
  const printersDirectory = path.join(workspace.dir, 'printers');
  const filamentsDirectory = path.join(workspace.dir, 'filaments');

  return async (req, res, next) => {
    const requestUrl = req.url;
    if (!requestUrl) {
      next();
      return;
    }

    const url = new URL(requestUrl, 'http://localhost');
    const isWorkspaceRequest = url.pathname === WORKSPACE_API;
    const isSceneRequest = url.pathname.startsWith(`${SCENE_API_PREFIX}/`);
    const isPostprocessRequest = url.pathname.startsWith(`${POSTPROCESS_API_PREFIX}/`);
    if (!isWorkspaceRequest && !isSceneRequest && !isPostprocessRequest) {
      next();
      return;
    }

    try {
      if (isWorkspaceRequest && req.method === 'GET') {
        const [scenes, postprocessScripts, printers, filaments] = await Promise.all([
          readAllSceneBundles(scenesDirectory),
          readFilesIn(postprocessDirectory, POSTPROCESS_FILE_PATTERN),
          readFilesIn(printersDirectory, PRESET_FILE_PATTERN),
          readFilesIn(filamentsDirectory, PRESET_FILE_PATTERN),
        ]);
        sendJson(res, 200, { label: workspace.label, scenes, postprocessScripts, printers, filaments });
        return;
      }

      if (isSceneRequest && req.method === 'PUT') {
        const segments = url.pathname
          .slice(`${SCENE_API_PREFIX}/`.length)
          .split('/')
          .map((segment) => decodeURIComponent(segment));
        const [sceneId, fileName] = segments;
        if (segments.length !== 2 || !isSafeSceneId(sceneId) || !isSafeFileName(fileName, SCENE_FILE_PATTERN)) {
          sendJson(res, 400, { error: 'Expected /scenes/<sceneId>/<fileName> with safe names.' });
          return;
        }

        const source = readSourcePayload(await readJsonBody(req));
        if (source === null) {
          sendJson(res, 400, { error: 'Scene source is required.' });
          return;
        }

        const sceneDirectory = path.join(scenesDirectory, sceneId);
        await fs.mkdir(sceneDirectory, { recursive: true });
        await fs.writeFile(path.join(sceneDirectory, fileName), source, 'utf8');
        sendJson(res, 200, { scene: await readSceneBundle(scenesDirectory, sceneId) });
        return;
      }

      if (isPostprocessRequest && req.method === 'PUT') {
        const fileName = decodeURIComponent(url.pathname.slice(`${POSTPROCESS_API_PREFIX}/`.length));
        if (!isSafeFileName(fileName, POSTPROCESS_FILE_PATTERN)) {
          sendJson(res, 400, { error: 'Invalid postprocess filename.' });
          return;
        }

        const source = readSourcePayload(await readJsonBody(req));
        if (source === null) {
          sendJson(res, 400, { error: 'Postprocess source is required.' });
          return;
        }

        await fs.mkdir(postprocessDirectory, { recursive: true });
        await fs.writeFile(path.join(postprocessDirectory, fileName), source, 'utf8');
        sendJson(res, 200, { document: { fileName, source } });
        return;
      }

      sendJson(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Workspace API failed.';
      const status = message.includes('ENOENT') ? 404 : 500;
      sendJson(res, status, { error: message });
    }
  };
}

async function readAllSceneBundles(scenesDirectory: string): Promise<SceneApiBundle[]> {
  const entries = await readDirectoryOrEmpty(scenesDirectory);
  const bundles = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && isSafeSceneId(entry.name))
      .map((entry) => readSceneBundle(scenesDirectory, entry.name))
  );

  return bundles
    .filter((bundle) => Object.keys(bundle.files).length > 0)
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function readSceneBundle(scenesDirectory: string, sceneId: string): Promise<SceneApiBundle> {
  const sceneDirectory = path.join(scenesDirectory, sceneId);
  const files: Record<string, string> = {};
  for (const file of await readFilesIn(sceneDirectory, SCENE_FILE_PATTERN)) {
    files[file.fileName] = file.source;
  }
  return { id: sceneId, files };
}

/** Text files matching `pattern` directly inside `directory`; [] when it does not exist. */
async function readFilesIn(directory: string, pattern: RegExp): Promise<WorkspaceApiFile[]> {
  const entries = await readDirectoryOrEmpty(directory);
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isSafeFileName(entry.name, pattern))
      .map(async (entry) => ({
        fileName: entry.name,
        source: await fs.readFile(path.join(directory, entry.name), 'utf8'),
      }))
  );
  return files.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

async function readDirectoryOrEmpty(directory: string) {
  try {
    return await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function isSafeSceneId(sceneId: string): boolean {
  return SCENE_ID_PATTERN.test(sceneId) && !sceneId.includes('..');
}

function isSafeFileName(fileName: string, pattern: RegExp): boolean {
  return pattern.test(fileName) && !fileName.includes('/') && !fileName.includes('\\') && !fileName.includes('..');
}

function readSourcePayload(value: unknown): string | null {
  const source = value && typeof value === 'object' ? (value as { source?: unknown }).source : null;
  return typeof source === 'string' ? source : null;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];

  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    req.on('end', () => resolve());
    req.on('error', reject);
  });

  if (chunks.length === 0) {
    return null;
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export default defineConfig(({ mode }) => ({
  // Subpath deployments (e.g. GitHub Pages) set BASE_PATH=/<repo>/ at build time.
  base: process.env.BASE_PATH || '/',
  plugins: [svelte(), createWorkspaceFilesApiPlugin(resolveWorkspaceRoot(mode))],
  optimizeDeps: {
    exclude: codeMirrorPackages,
  },
  server: {
    open: false,
    port: 3000,
    host: true,
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
    dedupe: codeMirrorPackages,
  },
}));
