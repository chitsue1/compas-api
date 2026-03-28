const router = require('express').Router();
const { register, login, refresh, logout, getMe } = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate, registerSchema, loginSchema, refreshSchema } = require('../middleware/validate.middleware');

router.post('/register', validate(registerSchema), register);
router.post('/login',    validate(loginSchema),    login);
router.post('/refresh',  validate(refreshSchema),  refresh);
router.post('/logout',   authenticate,             logout);
router.get('/me',        authenticate,             getMe);

module.exports = router;
