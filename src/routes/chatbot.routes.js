const router = require('express').Router();
const { chat } = require('../controllers/chatbot.controller');
const { optionalAuth } = require('../middleware/auth.middleware');
const rateLimit = require('express-rate-limit');

// Chatbot specific rate limit: 30 messages per minute per IP
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'ძალიან ბევრი შეტყობინება, სცადეთ 1 წუთში' },
});

// Chat is available to guests too (no auth required)
router.post('/', chatLimiter, optionalAuth, chat);

module.exports = router;
