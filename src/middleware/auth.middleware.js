const jwt = require('jsonwebtoken');
const { client: redis } = require('../config/redis');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token არ მოიძებნა' });
    }
    const token = authHeader.split(' ')[1];

    const blacklisted = await redis.get(`blacklist:${token}`);
    if (blacklisted) {
      return res.status(401).json({ error: 'Token გაუქმებულია' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token ვადაგასულია' });
    }
    return res.status(401).json({ error: 'Token არასწორია' });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return next();
    const token = authHeader.split(' ')[1];
    const blacklisted = await redis.get(`blacklist:${token}`);
    if (!blacklisted) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    }
  } catch {}
  next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'ავტორიზაცია საჭიროა' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'წვდომა შეზღუდულია' });
  next();
};

module.exports = { authenticate, optionalAuth, requireRole };
