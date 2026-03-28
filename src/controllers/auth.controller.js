const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { client: redis } = require('../config/redis');

// ─── Token helpers ────────────────────────────────────────────────

const signAccessToken = (user) =>
  jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

const signRefreshToken = (userId) =>
  jwt.sign(
    { id: userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  );

// ─── Register ─────────────────────────────────────────────────────

const register = async (req, res) => {
  try {
    const { email, phone, password, first_name, last_name, role } = req.body;

    // Check existing
    const exists = await db.query(
      'SELECT id FROM users WHERE email = $1 OR phone = $2',
      [email, phone || null]
    );
    if (exists.rows.length > 0) {
      return res.status(409).json({ error: 'Email ან ტელეფონი უკვე გამოყენებულია' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 12);

    // Allowed roles on register: user or agent only
    const safeRole = ['user', 'agent'].includes(role) ? role : 'user';

    const result = await db.query(
      `INSERT INTO users (email, phone, password_hash, first_name, last_name, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, phone, first_name, last_name, role, created_at`,
      [email, phone || null, password_hash, first_name || null, last_name || null, safeRole]
    );

    const user = result.rows[0];

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user.id);

    // Store refresh token hash in DB
    const tokenHash = await bcrypt.hash(refreshToken, 8);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, tokenHash, expiresAt]
    );

    return res.status(201).json({
      user,
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── Login ────────────────────────────────────────────────────────

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'არასწორი Email ან პაროლი' });
    }

    const user = result.rows[0];

    if (user.status === 'banned') {
      return res.status(403).json({ error: 'ანგარიში დაბლოკილია' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'არასწორი Email ან პაროლი' });
    }

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user.id);

    const tokenHash = await bcrypt.hash(refreshToken, 8);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, tokenHash, expiresAt]
    );

    const { password_hash, ...safeUser } = user;

    return res.json({
      user: safeUser,
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── Refresh ──────────────────────────────────────────────────────

const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token არ მოიძებნა' });
    }

    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ error: 'Refresh token ვადაგასულია' });
    }

    // Find valid token records for user
    const tokensResult = await db.query(
      'SELECT * FROM refresh_tokens WHERE user_id = $1 AND expires_at > NOW()',
      [payload.id]
    );

    let valid = false;
    let validTokenId = null;
    for (const row of tokensResult.rows) {
      const match = await bcrypt.compare(refreshToken, row.token_hash);
      if (match) {
        valid = true;
        validTokenId = row.id;
        break;
      }
    }

    if (!valid) {
      return res.status(401).json({ error: 'Refresh token არასწორია' });
    }

    // Delete used token (rotation)
    await db.query('DELETE FROM refresh_tokens WHERE id = $1', [validTokenId]);

    // Get user
    const userResult = await db.query(
      'SELECT id, email, phone, first_name, last_name, role, status FROM users WHERE id = $1',
      [payload.id]
    );
    const user = userResult.rows[0];

    const newAccessToken = signAccessToken(user);
    const newRefreshToken = signRefreshToken(user.id);

    const newHash = await bcrypt.hash(newRefreshToken, 8);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, newHash, expiresAt]
    );

    return res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    console.error('refresh error:', err);
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── Logout ───────────────────────────────────────────────────────

const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const userId = req.user?.id;

    if (refreshToken && userId) {
      // Remove all tokens for user (full logout) or just this token
      await db.query(
        'DELETE FROM refresh_tokens WHERE user_id = $1',
        [userId]
      );
    }

    // Blacklist access token in Redis until expiry
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.decode(token);
        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          await redis.setEx(`blacklist:${token}`, ttl, '1');
        }
      } catch {}
    }

    return res.json({ message: 'გამოსვლა წარმატებულია' });
  } catch (err) {
    console.error('logout error:', err);
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── Get me ───────────────────────────────────────────────────────

const getMe = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, phone, first_name, last_name, avatar_url,
              role, status, is_verified, agency_name, agency_logo, about, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

module.exports = { register, login, refresh, logout, getMe };
