const router = require('express').Router();
const { getPlans, initiatePayment, confirmPayment, getHistory } = require('../controllers/payment.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.get('/plans',       getPlans);
router.post('/initiate',   authenticate, initiatePayment);
router.post('/webhook',    confirmPayment);   // called by BOG/TBC, no auth
router.get('/history',     authenticate, getHistory);

module.exports = router;
