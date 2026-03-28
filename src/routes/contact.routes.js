const router = require('express').Router();
const { sendContact, getInbox, markAsRead, markAllRead } = require('../controllers/contact.controller');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');

router.post('/:listingId',        optionalAuth, sendContact);
router.get('/inbox',              authenticate, getInbox);
router.patch('/:contactId/read',  authenticate, markAsRead);
router.patch('/inbox/read-all',   authenticate, markAllRead);

module.exports = router;
