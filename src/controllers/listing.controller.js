const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { deleteFromS3 } = require('../config/s3');

// ─── Helpers ──────────────────────────────────────────────────────

const generateSlug = (title, id) => {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\u10D0-\u10FF\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${base}-${id.slice(0, 8)}`;
};

const calcPricePerM2 = (price, area) => {
  if (!price || !area || area === 0) return null;
  return parseFloat((price / area).toFixed(2));
};

// ─── CREATE ───────────────────────────────────────────────────────

const createListing = async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      deal_type, property_type,
      city_id, district_id, street_id, address_detail,
      latitude, longitude,
      price, price_currency, negotiable,
      area_total, area_living, area_kitchen,
      floor, floors_total, rooms, bedrooms, bathrooms, condition,
      title_ka, title_en, description_ka, description_en,
      tour_3d_url, video_url,
      features, // array of feature IDs
    } = req.body;

    const id = uuidv4();
    const price_per_m2 = calcPricePerM2(price, area_total);
    const slug = generateSlug(title_ka || title_en || 'listing', id);

    const result = await db.query(
      `INSERT INTO listings (
        id, user_id, deal_type, property_type, status,
        city_id, district_id, street_id, address_detail,
        latitude, longitude,
        price, price_currency, price_per_m2, negotiable,
        area_total, area_living, area_kitchen,
        floor, floors_total, rooms, bedrooms, bathrooms, condition,
        title_ka, title_en, description_ka, description_en,
        tour_3d_url, video_url, slug
      ) VALUES (
        $1,$2,$3,$4,'pending',
        $5,$6,$7,$8,
        $9,$10,
        $11,$12,$13,$14,
        $15,$16,$17,
        $18,$19,$20,$21,$22,$23,
        $24,$25,$26,$27,
        $28,$29,$30
      ) RETURNING *`,
      [
        id, userId, deal_type, property_type,
        city_id || null, district_id || null, street_id || null, address_detail || null,
        latitude || null, longitude || null,
        price, price_currency || 'USD', price_per_m2, negotiable || false,
        area_total || null, area_living || null, area_kitchen || null,
        floor || null, floors_total || null, rooms || null,
        bedrooms || null, bathrooms || null, condition || null,
        title_ka || null, title_en || null,
        description_ka || null, description_en || null,
        tour_3d_url || null, video_url || null, slug,
      ]
    );

    const listing = result.rows[0];

    // Insert features if provided
    if (features && Array.isArray(features) && features.length > 0) {
      const featureValues = features
        .map((fId) => `('${listing.id}', ${parseInt(fId)})`)
        .join(', ');
      await db.query(
        `INSERT INTO listing_features (listing_id, feature_id) VALUES ${featureValues}
         ON CONFLICT DO NOTHING`
      );
    }

    // Update search vector
    await db.query(
      `UPDATE listings SET search_vector =
        to_tsvector('simple', coalesce(title_ka,'') || ' ' || coalesce(title_en,'') || ' ' || coalesce(description_ka,'') || ' ' || coalesce(description_en,''))
       WHERE id = $1`,
      [listing.id]
    );

    return res.status(201).json(listing);
  } catch (err) {
    console.error('createListing error:', err);
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── GET ONE ──────────────────────────────────────────────────────

const getListing = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT
        l.*,
        c.name_ka  AS city_ka,    c.name_en  AS city_en,
        d.name_ka  AS district_ka, d.name_en AS district_en,
        u.first_name, u.last_name, u.phone AS user_phone,
        u.email AS user_email, u.avatar_url, u.agency_name,
        u.role AS user_role,
        COALESCE(
          json_agg(DISTINCT jsonb_build_object(
            'id', m.id, 'url', m.url,
            'url_thumb', m.url_thumb, 'url_medium', m.url_medium,
            'is_cover', m.is_cover, 'order_index', m.order_index
          )) FILTER (WHERE m.id IS NOT NULL), '[]'
        ) AS media,
        COALESCE(
          json_agg(DISTINCT jsonb_build_object(
            'id', f.id, 'name_ka', f.name_ka,
            'name_en', f.name_en, 'icon', f.icon
          )) FILTER (WHERE f.id IS NOT NULL), '[]'
        ) AS features
       FROM listings l
       LEFT JOIN cities c ON l.city_id = c.id
       LEFT JOIN districts d ON l.district_id = d.id
       LEFT JOIN users u ON l.user_id = u.id
       LEFT JOIN listing_media m ON m.listing_id = l.id
       LEFT JOIN listing_features lf ON lf.listing_id = l.id
       LEFT JOIN features f ON f.id = lf.feature_id
       WHERE l.id = $1 OR l.slug = $1
       GROUP BY l.id, c.name_ka, c.name_en, d.name_ka, d.name_en,
                u.first_name, u.last_name, u.phone, u.email,
                u.avatar_url, u.agency_name, u.role`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'განცხადება ვერ მოიძებნა' });
    }

    const listing = result.rows[0];

    // Increment view count (fire and forget)
    db.query('UPDATE listings SET views_count = views_count + 1 WHERE id = $1', [listing.id]);

    return res.json(listing);
  } catch (err) {
    console.error('getListing error:', err);
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── UPDATE ───────────────────────────────────────────────────────

const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const role = req.user.role;

    // Ownership check
    const check = await db.query('SELECT user_id, status FROM listings WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'განცხადება ვერ მოიძებნა' });
    if (check.rows[0].user_id !== userId && role !== 'admin') {
      return res.status(403).json({ error: 'წვდომა შეზღუდულია' });
    }

    const fields = [
      'deal_type','property_type','city_id','district_id','street_id','address_detail',
      'latitude','longitude','price','price_currency','negotiable',
      'area_total','area_living','area_kitchen','floor','floors_total',
      'rooms','bedrooms','bathrooms','condition',
      'title_ka','title_en','description_ka','description_en',
      'tour_3d_url','video_url',
    ];

    const updates = [];
    const values = [];
    let idx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx}`);
        values.push(req.body[field]);
        idx++;
      }
    }

    if (req.body.area_total || req.body.price) {
      const priceVal = req.body.price || check.rows[0].price;
      const areaVal = req.body.area_total || check.rows[0].area_total;
      updates.push(`price_per_m2 = $${idx}`);
      values.push(calcPricePerM2(priceVal, areaVal));
      idx++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'განახლებადი ველი არ მოიძებნა' });
    }

    updates.push(`updated_at = NOW()`);
    // Re-set to pending on edit (requires re-approval)
    if (role !== 'admin') {
      updates.push(`status = 'pending'`);
    }

    values.push(id);
    const result = await db.query(
      `UPDATE listings SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    // Update features
    if (req.body.features !== undefined) {
      await db.query('DELETE FROM listing_features WHERE listing_id = $1', [id]);
      if (req.body.features.length > 0) {
        const fv = req.body.features.map((fId) => `('${id}', ${parseInt(fId)})`).join(', ');
        await db.query(`INSERT INTO listing_features (listing_id, feature_id) VALUES ${fv} ON CONFLICT DO NOTHING`);
      }
    }

    // Update search vector
    await db.query(
      `UPDATE listings SET search_vector =
        to_tsvector('simple', coalesce(title_ka,'') || ' ' || coalesce(title_en,'') || ' ' || coalesce(description_ka,'') || ' ' || coalesce(description_en,''))
       WHERE id = $1`,
      [id]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error('updateListing error:', err);
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── DELETE ───────────────────────────────────────────────────────

const deleteListing = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const role = req.user.role;

    const check = await db.query(
      'SELECT user_id FROM listings WHERE id = $1', [id]
    );
    if (check.rows.length === 0) return res.status(404).json({ error: 'განცხადება ვერ მოიძებნა' });
    if (check.rows[0].user_id !== userId && role !== 'admin') {
      return res.status(403).json({ error: 'წვდომა შეზღუდულია' });
    }

    // Delete media from S3
    const media = await db.query('SELECT url FROM listing_media WHERE listing_id = $1', [id]);
    for (const row of media.rows) {
      try {
        const key = row.url.split('.com/')[1];
        if (key) await deleteFromS3(key);
      } catch {}
    }

    await db.query('DELETE FROM listings WHERE id = $1', [id]);
    return res.json({ message: 'განცხადება წაშლილია' });
  } catch (err) {
    console.error('deleteListing error:', err);
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── MY LISTINGS ──────────────────────────────────────────────────

const getMyListings = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const result = await db.query(
      `SELECT l.*,
        c.name_ka AS city_ka, d.name_ka AS district_ka,
        (SELECT url FROM listing_media WHERE listing_id = l.id AND is_cover = true LIMIT 1) AS cover_url
       FROM listings l
       LEFT JOIN cities c ON l.city_id = c.id
       LEFT JOIN districts d ON l.district_id = d.id
       WHERE l.user_id = $1
       ORDER BY l.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const total = await db.query('SELECT COUNT(*) FROM listings WHERE user_id = $1', [userId]);

    return res.json({
      data: result.rows,
      pagination: {
        page, limit,
        total: parseInt(total.rows[0].count),
        pages: Math.ceil(total.rows[0].count / limit),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── UPLOAD MEDIA ─────────────────────────────────────────────────

const uploadMedia = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const role = req.user.role;

    const check = await db.query('SELECT user_id FROM listings WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'განცხადება ვერ მოიძებნა' });
    if (check.rows[0].user_id !== userId && role !== 'admin') {
      return res.status(403).json({ error: 'წვდომა შეზღუდულია' });
    }

    // Check photo limit
    const countResult = await db.query(
      'SELECT COUNT(*) FROM listing_media WHERE listing_id = $1', [id]
    );
    const currentCount = parseInt(countResult.rows[0].count);
    const maxPhotos = parseInt(process.env.MAX_PHOTOS_PER_LISTING) || 30;

    if (currentCount + req.files.length > maxPhotos) {
      return res.status(400).json({ error: `მაქსიმუმ ${maxPhotos} ფოტო შეიძლება` });
    }

    const inserted = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const isFirst = currentCount === 0 && i === 0;
      const result = await db.query(
        `INSERT INTO listing_media (listing_id, url, order_index, is_cover)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [id, file.location, currentCount + i, isFirst]
      );
      inserted.push(result.rows[0]);
    }

    return res.status(201).json(inserted);
  } catch (err) {
    console.error('uploadMedia error:', err);
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── DELETE MEDIA ─────────────────────────────────────────────────

const deleteMedia = async (req, res) => {
  try {
    const { id, mediaId } = req.params;
    const userId = req.user.id;
    const role = req.user.role;

    const listing = await db.query('SELECT user_id FROM listings WHERE id = $1', [id]);
    if (listing.rows.length === 0) return res.status(404).json({ error: 'განცხადება ვერ მოიძებნა' });
    if (listing.rows[0].user_id !== userId && role !== 'admin') {
      return res.status(403).json({ error: 'წვდომა შეზღუდულია' });
    }

    const media = await db.query('SELECT * FROM listing_media WHERE id = $1 AND listing_id = $2', [mediaId, id]);
    if (media.rows.length === 0) return res.status(404).json({ error: 'ფოტო ვერ მოიძებნა' });

    // Delete from S3
    try {
      const key = media.rows[0].url.split('.com/')[1];
      if (key) await deleteFromS3(key);
    } catch {}

    await db.query('DELETE FROM listing_media WHERE id = $1', [mediaId]);

    // If deleted cover, assign new cover
    if (media.rows[0].is_cover) {
      await db.query(
        `UPDATE listing_media SET is_cover = true
         WHERE listing_id = $1 ORDER BY order_index ASC LIMIT 1`,
        [id]
      );
    }

    return res.json({ message: 'ფოტო წაშლილია' });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── SET COVER ────────────────────────────────────────────────────

const setCover = async (req, res) => {
  try {
    const { id, mediaId } = req.params;
    const userId = req.user.id;

    const listing = await db.query('SELECT user_id FROM listings WHERE id = $1', [id]);
    if (!listing.rows[0] || (listing.rows[0].user_id !== userId && req.user.role !== 'admin')) {
      return res.status(403).json({ error: 'წვდომა შეზღუდულია' });
    }

    await db.query('UPDATE listing_media SET is_cover = false WHERE listing_id = $1', [id]);
    await db.query('UPDATE listing_media SET is_cover = true WHERE id = $1 AND listing_id = $2', [mediaId, id]);

    return res.json({ message: 'მთავარი ფოტო განახლდა' });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── GET FEATURES & LOCATIONS (reference data) ───────────────────

const getFeatures = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM features ORDER BY category, id');
    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

const getCities = async (req, res) => {
  try {
    const cities = await db.query('SELECT * FROM cities ORDER BY id');
    const districts = await db.query('SELECT * FROM districts ORDER BY city_id, id');
    return res.json({ cities: cities.rows, districts: districts.rows });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

module.exports = {
  createListing, getListing, updateListing, deleteListing,
  getMyListings, uploadMedia, deleteMedia, setCover,
  getFeatures, getCities,
};
