const { spawn } = require('child_process');
const fs = require('fs');

const candidates = [
  process.env.CLOUDFLARED_PATH,
  'C:/Program Files (x86)/cloudflared/cloudflared.exe',
  'C:/Program Files/cloudflared/cloudflared.exe',
  'cloudflared'
].filter(Boolean);

const cloudflared = candidates.find((c) => c.includes('/') || c.includes('\\') ? fs.existsSync(c) : true);
const args = ['tunnel', '--url', 'http://localhost:8081'];

const child = spawn(cloudflared, args, { stdio: 'inherit', shell: cloudflared === 'cloudflared' });
child.on('error', (err) => {
  console.error('Ошибка запуска cloudflared:', err.message);
  console.error('Скачай: https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe');
  process.exit(1);
});
child.on('exit', (code) => process.exit(code));
