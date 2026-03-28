const db = require('../config/database');
const bcrypt = require('bcryptjs');

// ─── GET PROFILE (public) ─────────────────────────────────────────

const getProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.avatar_url,
              u.role, u.agency_name, u.agency_logo, u.about,
              u.created_at,
              COUNT(l.id) FILTER (WHERE l.status = 'active') AS active_listings
       FROM users u
       LEFT JOIN listings l ON l.user_id = u.id
       WHERE u.id = $1
       GROUP BY u.id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'მომხმარებელი ვერ მოიძებნა' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── UPDATE MY PROFILE ────────────────────────────────────────────

const updateMe = async (req, res) => {
  try {
    const userId = req.user.id;
    const { first_name, last_name, phone, about, agency_name } = req.body;

    const result = await db.query(
      `UPDATE users
       SET first_name   = COALESCE($1, first_name),
           last_name    = COALESCE($2, last_name),
           phone        = COALESCE($3, phone),
           about        = COALESCE($4, about),
           agency_name  = COALESCE($5, agency_name),
           updated_at   = NOW()
       WHERE id = $6
       RETURNING id, email, phone, first_name, last_name,
                 avatar_url, role, agency_name, about`,
      [first_name || null, last_name || null, phone || null,
       about || null, agency_name || null, userId]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── CHANGE PASSWORD ──────────────────────────────────────────────

const changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'ორივე ველი სავალდებულოა' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'პაროლი მინიმუმ 8 სიმბოლო უნდა იყოს' });
    }

    const result = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    const valid = await bcrypt.compare(current_password, result.rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'მიმდინარე პაროლი არასწორია' });
    }

    const newHash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);

    return res.json({ message: 'პაროლი შეიცვალა' });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── GET USER'S LISTINGS (public) ────────────────────────────────

const getUserListings = async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const result = await db.query(
      `SELECT l.id, l.slug, l.deal_type, l.property_type,
              l.price, l.price_currency, l.area_total, l.rooms,
              l.floor, l.title_ka, l.title_en,
              c.name_ka AS city_ka, d.name_ka AS district_ka,
              l.published_at, l.views_count, l.tour_3d_url,
              (SELECT url FROM listing_media
               WHERE listing_id = l.id AND is_cover = true LIMIT 1) AS cover_url
       FROM listings l
       LEFT JOIN cities c ON l.city_id = c.id
       LEFT JOIN districts d ON l.district_id = d.id
       WHERE l.user_id = $1 AND l.status = 'active'
       ORDER BY l.is_boosted DESC, l.published_at DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    const total = await db.query(
      `SELECT COUNT(*) FROM listings WHERE user_id = $1 AND status = 'active'`,
      [id]
    );

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

// ─── FAVORITES ────────────────────────────────────────────────────

const getFavorites = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const result = await db.query(
      `SELECT l.id, l.slug, l.deal_type, l.property_type,
              l.price, l.price_currency, l.area_total, l.rooms,
              l.floor, l.title_ka, l.title_en,
              c.name_ka AS city_ka, d.name_ka AS district_ka,
              f.created_at AS saved_at, l.tour_3d_url,
              (SELECT url FROM listing_media
               WHERE listing_id = l.id AND is_cover = true LIMIT 1) AS cover_url
       FROM favorites f
       JOIN listings l ON l.id = f.listing_id
       LEFT JOIN cities c ON l.city_id = c.id
       LEFT JOIN districts d ON l.district_id = d.id
       WHERE f.user_id = $1
       ORDER BY f.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const total = await db.query(
      'SELECT COUNT(*) FROM favorites WHERE user_id = $1', [userId]
    );

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

const toggleFavorite = async (req, res) => {
  try {
    const userId = req.user.id;
    const { listingId } = req.params;

    const exists = await db.query(
      'SELECT 1 FROM favorites WHERE user_id = $1 AND listing_id = $2',
      [userId, listingId]
    );

    if (exists.rows.length > 0) {
      await db.query(
        'DELETE FROM favorites WHERE user_id = $1 AND listing_id = $2',
        [userId, listingId]
      );
      return res.json({ saved: false, message: 'წაშლილია სიყვარულიდან' });
    } else {
      await db.query(
        'INSERT INTO favorites (user_id, listing_id) VALUES ($1, $2)',
        [userId, listingId]
      );
      return res.json({ saved: true, message: 'დამახსოვრებულია' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

const checkFavorite = async (req, res) => {
  try {
    const userId = req.user.id;
    const { listingId } = req.params;
    const result = await db.query(
      'SELECT 1 FROM favorites WHERE user_id = $1 AND listing_id = $2',
      [userId, listingId]
    );
    return res.json({ saved: result.rows.length > 0 });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

module.exports = {
  getProfile, updateMe, changePassword,
  getUserListings,
  getFavorites, toggleFavorite, checkFavorite,
};
