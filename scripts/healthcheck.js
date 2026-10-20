'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const https = require('https');

const timeoutMs = Number.parseInt(process.env.HEALTHCHECK_TIMEOUT_MS || '8000', 10);
const localPort = Number.parseInt(process.env.BATTLEPASS_PORT || '8081', 10);
const checks = [
  { name: 'axe-web-local', url: `http://127.0.0.1:${localPort}/health`, required: true }
];

const publicBase = (process.env.BATTLEPASS_URL || '').trim().replace(/\/$/, '');
if (publicBase) checks.push({ name: 'axe-web-public', url: `${publicBase}/health`, required: false });

function check(target) {
  return new Promise(resolve => {
    const started = Date.now();
    let parsed;
    try {
      parsed = new URL(target.url);
    } catch (error) {
      resolve({ ...target, ok: false, error: 'invalid URL', elapsedMs: 0 });
      return;
    }

    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.get(parsed, {
      timeout: timeoutMs,
      headers: { 'User-Agent': 'axe-healthcheck/1.0', Connection: 'close' }
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        if (body.length < 4096) body += chunk;
      });
      response.on('end', () => {
        let healthyBody = false;
        try {
          healthyBody = JSON.parse(body).ok === true;
        } catch (_) {}
        resolve({
          ...target,
          ok: response.statusCode === 200 && healthyBody,
          status: response.statusCode,
          elapsedMs: Date.now() - started,
          error: healthyBody ? null : `unexpected response: ${body.slice(0, 160)}`
        });
      });
    });
    request.on('timeout', () => request.destroy(new Error(`timeout after ${timeoutMs}ms`)));
    request.on('error', error => resolve({
      ...target,
      ok: false,
      elapsedMs: Date.now() - started,
      error: `${error.code || 'ERROR'}: ${error.message}`
    }));
  });
}

Promise.all(checks.map(check)).then(results => {
  for (const result of results) {
    const mark = result.ok ? 'OK' : (result.required ? 'FAIL' : 'WARN');
    const detail = result.ok
      ? `HTTP ${result.status}, ${result.elapsedMs}ms`
      : result.error;
    console.log(`[${mark}] ${result.name}: ${detail}`);
  }
  if (results.some(result => result.required && !result.ok)) process.exitCode = 1;
}).catch(error => {
  console.error('[FAIL] healthcheck:', error.stack || error);
  process.exitCode = 1;
});
