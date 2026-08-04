// perf.js — замер длительности обработчиков и сбор медленных операций.
// Секреты в логи не попадают: логируются только label и длительность.

const SLOW_MS = Number(process.env.SLOW_MS || 150);
const PERF_LOG = process.env.PERF_LOG === '1';
const slowOps = [];

// Оборачивает функцию: замеряет время и логирует медленные/все вызовы.
function wrap(label, fn) {
  return function (...args) {
    const t0 = process.hrtime.bigint();
    const done = () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (ms >= SLOW_MS) {
        slowOps.push({ label, ms: Math.round(ms), at: new Date().toISOString() });
        if (slowOps.length > 1000) slowOps.shift();
        console.warn(`[perf] ${label}: ${Math.round(ms)}ms`);
      } else if (PERF_LOG) {
        console.log(`[perf] ${label}: ${Math.round(ms)}ms`);
      }
    };
    try {
      const result = fn.apply(this, args);
      if (result && typeof result.then === 'function') {
        return result.finally(done);
      }
      done();
      return result;
    } catch (err) {
      done();
      throw err;
    }
  };
}

// Список самых медленных операций (для отчёта/диагностики).
function slowOpsReport(limit = 20) {
  return slowOps.slice().sort((a, b) => b.ms - a.ms).slice(0, limit);
}

module.exports = { wrap, slowOpsReport, SLOW_MS };
