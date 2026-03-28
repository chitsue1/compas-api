const rateLimit = require('express-rate-limit');

// ─── Rate limiters ────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'ძალიან ბევრი მცდელობა, სცადეთ 15 წუთში' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  message: { error: 'ძალიან ბევრი მოთხოვნა' },
});

// ─── Global error handler ─────────────────────────────────────────

const errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || 500;
  const message = err.message || 'სერვერის შეცდომა';
  res.status(status).json({ error: message });
};

// ─── 404 handler ──────────────────────────────────────────────────

const notFound = (req, res) => {
  res.status(404).json({ error: `Route ვერ მოიძებნა: ${req.method} ${req.path}` });
};

module.exports = { authLimiter, apiLimiter, errorHandler, notFound };
