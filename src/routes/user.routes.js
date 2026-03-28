const router = require('express').Router();
const {
  getProfile, updateMe, changePassword,
  getUserListings,
  getFavorites, toggleFavorite, checkFavorite,
} = require('../controllers/user.controller');
const { authenticate } = require('../middleware/auth.middleware');

// ─── Public ───────────────────────────────────────────────────────
router.get('/:id/profile',  getProfile);
router.get('/:id/listings', getUserListings);

// ─── Protected ────────────────────────────────────────────────────
router.put('/me',              authenticate, updateMe);
router.put('/me/password',     authenticate, changePassword);

router.get('/me/favorites',                    authenticate, getFavorites);
router.post('/me/favorites/:listingId',        authenticate, toggleFavorite);
router.get('/me/favorites/:listingId/check',   authenticate, checkFavorite);

module.exports = router;
