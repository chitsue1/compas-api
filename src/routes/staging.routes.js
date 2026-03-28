const router = require('express').Router();
const {
  generateStaging, getStagingHistory,
  getStagingOptions, getStagingUsage,
} = require('../controllers/staging.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/options',                         getStagingOptions);
router.get('/usage',                           getStagingUsage);
router.post('/listings/:listing_id/generate',  generateStaging);
router.get('/listings/:listing_id/history',    getStagingHistory);

module.exports = router;
