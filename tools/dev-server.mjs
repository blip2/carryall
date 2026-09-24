#!/usr/bin/env node
// Local test server. Serves a folder (default: examples/) on http://localhost:8765 to play
// the part of the hosted "home" copy. PUT /_saved/<name>.html writes into <folder>/_saved/
// so automated tests can capture exported files. Development use only.
//   node tools/dev-server.mjs [folder] [port]
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve, basename, sep } from 'node:path';

const dir = resolve(process.argv[2] || 'examples');
const port = Number(process.argv[3] || 8765);
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css', '.csv': 'text/csv' };

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (req.method === 'PUT' && path.startsWith('/_saved/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      await mkdir(join(dir, '_saved'), { recursive: true });
      await writeFile(join(dir, '_saved', basename(path)), Buffer.concat(chunks));
      res.writeHead(204).end();
      return;
    }
    let file = resolve(join(dir, path));
    if (file !== dir && !file.startsWith(dir + sep)) throw new Error('outside root');
    if (path.endsWith('/')) file = join(file, 'index.html');
    const body = await readFile(file);
    // CORS on version files so saved copies (file://) can check for updates.
    const cors = path.endsWith('.version.json') ? { 'Access-Control-Allow-Origin': '*' } : {};
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', ...cors }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Serving ${dir} at http://localhost:${port}/`));
