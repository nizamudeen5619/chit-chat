const requiredInProduction = (key) => {
  if (process.env.NODE_ENV === 'production' && !process.env[key]) {
    throw new Error(`Missing required env var in production: ${key}`);
  }
};

const parseCsv = (value) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

function getConfig() {
  // Secrets: fail-fast in production to avoid runtime-generated secrets
  requiredInProduction('JWT_ACCESS_SECRET');
  requiredInProduction('JWT_REFRESH_SECRET');
  requiredInProduction('DATABASE_ENCRYPTION_KEY');

  const corsOrigins = parseCsv(process.env.CORS_ORIGIN || process.env.ALLOWED_ORIGINS || 'http://localhost:4200');

  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: Number(process.env.PORT || 3000),
    corsOrigins,
    // Cookie settings for cross-origin deployments
    cookies: {
      // In production (different-origin + HTTPS), refresh cookie must be SameSite=None;Secure
      refreshSameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      refreshSecure: process.env.NODE_ENV === 'production'
    }
  };
}

module.exports = { getConfig };

