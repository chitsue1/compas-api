const router = require('express').Router();
const {
  createListing, getListing, updateListing, deleteListing,
  getMyListings, uploadMedia, deleteMedia, setCover,
  getFeatures, getCities,
} = require('../controllers/listing.controller');
const { search, getMapListings, getSimilar } = require('../controllers/search.controller');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validate.middleware');
const { createListingSchema, updateListingSchema } = require('../middleware/listing.validation');
const { upload } = require('../config/s3');

// ─── Reference data (public) ──────────────────────────────────────
router.get('/meta/features', getFeatures);
router.get('/meta/cities',   getCities);

// ─── Search (public) ──────────────────────────────────────────────
router.get('/',         optionalAuth, search);
router.get('/map',      getMapListings);
router.get('/:id/similar', getSimilar);

// ─── Single listing (public) ──────────────────────────────────────
router.get('/:id', optionalAuth, getListing);

// ─── Protected: create / update / delete ─────────────────────────
router.post('/',
  authenticate,
  validate(createListingSchema),
  createListing
);

router.put('/:id',
  authenticate,
  validate(updateListingSchema),
  updateListing
);

router.delete('/:id',
  authenticate,
  deleteListing
);

// ─── Protected: media ─────────────────────────────────────────────
router.post('/:id/media',
  authenticate,
  upload.array('photos', 30),
  uploadMedia
);

router.delete('/:id/media/:mediaId',
  authenticate,
  deleteMedia
);

router.patch('/:id/media/:mediaId/cover',
  authenticate,
  setCover
);

// ─── My listings ──────────────────────────────────────────────────
router.get('/user/me',
  authenticate,
  getMyListings
);

module.exports = router;
