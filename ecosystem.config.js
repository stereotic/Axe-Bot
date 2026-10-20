const path = require('path');

const cwd = __dirname;
const common = {
  cwd,
  interpreter: process.execPath,
  time: true,
  autorestart: true,
  watch: false,
  min_uptime: '20s',
  max_restarts: 10,
  restart_delay: 3000,
  exp_backoff_restart_delay: 250,
  kill_timeout: 8000,
  listen_timeout: 10000,
  merge_logs: true,
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  env: {
    NODE_ENV: 'production'
  }
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'axe-web',
      script: path.join(cwd, 'battlepass_server.js'),
      output: path.join(cwd, 'logs', 'axe-web.out.log'),
      error: path.join(cwd, 'logs', 'axe-web.err.log'),
      max_memory_restart: '350M'
    },
    {
      ...common,
      name: 'axe-bot',
      script: path.join(cwd, 'bot.js'),
      output: path.join(cwd, 'logs', 'axe-bot.out.log'),
      error: path.join(cwd, 'logs', 'axe-bot.err.log'),
      max_memory_restart: '700M',
      env: {
        ...common.env,
        BATTLEPASS_EMBEDDED: '0'
      }
    }
  ]
};
