require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const { connect: connectRedis } = require('./config/redis');
const { pool } = require('./config/database');

const authRoutes    = require('./routes/auth.routes');
const listingRoutes = require('./routes/listing.routes');
const userRoutes    = require('./routes/user.routes');
const contactRoutes = require('./routes/contact.routes');
const adminRoutes   = require('./routes/admin.routes');
const paymentRoutes = require('./routes/payment.routes');
const aiRoutes      = require('./routes/ai.routes');
const stagingRoutes = require('./routes/staging.routes');
const chatbotRoutes = require('./routes/chatbot.routes');
const { authLimiter, apiLimiter, errorHandler, notFound } = require('./middleware/error.middleware');
const { sanitize } = require('./middleware/sanitize.middleware');

const app = express();

// ─── Security & Middleware ────────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sanitize);
app.use(morgan('dev'));

// ─── Health check ─────────────────────────────────────────────────

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

// ─── Routes ───────────────────────────────────────────────────────

app.use('/api/auth',     authLimiter, authRoutes);
app.use('/api/listings', apiLimiter,  listingRoutes);
app.use('/api/users',    apiLimiter,  userRoutes);
app.use('/api/contacts', apiLimiter,  contactRoutes);
app.use('/api/admin',    apiLimiter,  adminRoutes);
app.use('/api/payments', apiLimiter,  paymentRoutes);
app.use('/api/ai',       apiLimiter,  aiRoutes);
app.use('/api/staging',  apiLimiter,  stagingRoutes);
app.use('/api/chat',     chatbotRoutes);

// ─── Error handlers ───────────────────────────────────────────────

app.use(notFound);
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

const start = async () => {
  try {
    await connectRedis();
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
      console.log(`   ENV: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('❌ Startup failed:', err);
    process.exit(1);
  }
};

start();

module.exports = app;
