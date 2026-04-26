const levels = ['debug', 'info', 'warn', 'error'];

function shouldLog(level) {
  const env = process.env.NODE_ENV || 'development';
  if (env !== 'production') return true;
  // In production, reduce noise; keep warn/error by default.
  return level === 'warn' || level === 'error';
}

function log(level, message, meta) {
  if (!levels.includes(level)) level = 'info';
  if (!shouldLog(level)) return;

  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: String(message)
  };

  if (meta && typeof meta === 'object') {
    payload.meta = meta;
  }

  const line = JSON.stringify(payload);
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

module.exports = {
  debug: (m, meta) => log('debug', m, meta),
  info: (m, meta) => log('info', m, meta),
  warn: (m, meta) => log('warn', m, meta),
  error: (m, meta) => log('error', m, meta)
};

