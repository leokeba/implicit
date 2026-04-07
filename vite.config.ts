import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Connect, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const SCENE_API_PREFIX = '/__implicit_api/scenes';
const SCENE_FILE_PATTERN = /^[a-z0-9][a-z0-9 _.()-]*\.glsl$/i;
const scenesDirectory = fileURLToPath(new URL('./src/shaders/scenes', import.meta.url));

interface SceneApiDocument {
  id: string;
  name: string;
  fileName: string;
  source: string;
}

function createSceneFilesApiPlugin(): Plugin {
  const middleware = createSceneApiMiddleware();

  return {
    name: 'implicit-scene-files-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

function createSceneApiMiddleware(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const requestUrl = req.url;
    if (!requestUrl) {
      next();
      return;
    }

    const url = new URL(requestUrl, 'http://localhost');
    if (url.pathname !== SCENE_API_PREFIX && !url.pathname.startsWith(`${SCENE_API_PREFIX}/`)) {
      next();
      return;
    }

    try {
      if (req.method === 'GET' && url.pathname === SCENE_API_PREFIX) {
        const documents = await readAllSceneDocuments();
        sendJson(res, 200, { mode: 'filesystem', documents });
        return;
      }

      const fileName = decodeURIComponent(url.pathname.slice(`${SCENE_API_PREFIX}/`.length));
      if (!isSafeSceneFileName(fileName)) {
        sendJson(res, 400, { error: 'Invalid scene filename.' });
        return;
      }

      if (req.method === 'GET') {
        const document = await readSceneDocument(fileName);
        sendJson(res, 200, { document });
        return;
      }

      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        const source = isSceneWritePayload(body) ? body.source : null;
        if (source === null) {
          sendJson(res, 400, { error: 'Scene source is required.' });
          return;
        }

        await fs.mkdir(scenesDirectory, { recursive: true });
        await fs.writeFile(path.join(scenesDirectory, fileName), source, 'utf8');
        const document = buildSceneApiDocument(fileName, source);
        sendJson(res, 200, { document });
        return;
      }

      sendJson(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Scene API failed.';
      const status = message.includes('ENOENT') ? 404 : 500;
      sendJson(res, status, { error: message });
    }
  };
}

async function readAllSceneDocuments(): Promise<SceneApiDocument[]> {
  const entries = await fs.readdir(scenesDirectory, { withFileTypes: true });
  const documents = await Promise.all(
    entries
      .filter((entry: { isFile: () => boolean; name: string }) => entry.isFile() && isSafeSceneFileName(entry.name))
      .map(async (entry: { name: string }) => {
        const source = await fs.readFile(path.join(scenesDirectory, entry.name), 'utf8');
        return buildSceneApiDocument(entry.name, source);
      })
  );

  return documents.sort((left: SceneApiDocument, right: SceneApiDocument) => left.name.localeCompare(right.name));
}

async function readSceneDocument(fileName: string): Promise<SceneApiDocument> {
  const source = await fs.readFile(path.join(scenesDirectory, fileName), 'utf8');
  return buildSceneApiDocument(fileName, source);
}

function buildSceneApiDocument(fileName: string, source: string): SceneApiDocument {
  const id = fileName.replace(/\.glsl$/i, '');
  const name = id
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ') || 'Scene';

  return {
    id,
    name,
    fileName,
    source,
  };
}

function isSafeSceneFileName(fileName: string): boolean {
  return SCENE_FILE_PATTERN.test(fileName) && !fileName.includes('/') && !fileName.includes('\\') && !fileName.includes('..');
}

function isSceneWritePayload(value: unknown): value is { source: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as { source?: unknown }).source === 'string');
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

export default defineConfig({
  plugins: [svelte(), createSceneFilesApiPlugin()],
  optimizeDeps: {
    exclude: ['svelte-codemirror-editor', 'codemirror', '@codemirror/lang-cpp', '@codemirror/theme-one-dark'],
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
  },
});