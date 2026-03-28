const router = require('express').Router();
const { generateDescription, selectCoverPhoto, autoTag, getAiUsage } = require('../controllers/ai.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/usage',                          getAiUsage);
router.post('/generate-description',          generateDescription);
router.post('/listings/:listing_id/cover',    selectCoverPhoto);
router.post('/listings/:listing_id/auto-tag', autoTag);

module.exports = router;
