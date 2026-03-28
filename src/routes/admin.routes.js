const router = require('express').Router();
const {
  getStats,
  adminGetListings, approveListing, rejectListing,
  setBoost, removeBoost,
  adminGetUsers, setUserStatus, verifyUser,
  adminGetPayments,
} = require('../controllers/admin.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

// All admin routes require authentication + admin role
router.use(authenticate, requireRole('admin'));

// ─── Stats ────────────────────────────────────────────────────────
router.get('/stats', getStats);

// ─── Listings ─────────────────────────────────────────────────────
router.get('/listings',                    adminGetListings);
router.patch('/listings/:id/approve',      approveListing);
router.patch('/listings/:id/reject',       rejectListing);
router.patch('/listings/:id/boost',        setBoost);
router.patch('/listings/:id/boost/remove', removeBoost);

// ─── Users ────────────────────────────────────────────────────────
router.get('/users',                  adminGetUsers);
router.patch('/users/:id/status',     setUserStatus);
router.patch('/users/:id/verify',     verifyUser);

// ─── Payments ─────────────────────────────────────────────────────
router.get('/payments', adminGetPayments);

module.exports = router;
