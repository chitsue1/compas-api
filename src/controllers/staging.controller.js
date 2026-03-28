const db = require('../config/database');
const { s3, deleteFromS3 } = require('../config/s3');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');

const DECOR8_API = 'https://api.decor8.ai';
const DECOR8_KEY = process.env.DECOR8_API_KEY;

// ─── Available styles & room types ───────────────────────────────

const ROOM_STYLES = [
  'modern', 'scandinavian', 'industrial', 'bohemian',
  'farmhouse', 'coastal', 'luxury', 'minimalist',
  'traditional', 'contemporary',
];

const ROOM_TYPES = [
  'living_room', 'bedroom', 'kitchen', 'dining_room',
  'bathroom', 'home_office', 'kids_room', 'hallway',
];

// ─── Staging usage limits (per plan/month) ───────────────────────

const STAGING_LIMITS = {
  free:     2,
  standard: 10,
  premium:  30,
  vip:      999,
};

// ─── Check staging usage ──────────────────────────────────────────

const checkStagingUsage = async (userId) => {
  const result = await db.query(
    `SELECT staging_uses_count, staging_uses_reset_at,
            COALESCE(
              (SELECT plan FROM payments
               WHERE user_id = users.id AND status = 'success'
               ORDER BY created_at DESC LIMIT 1),
              'free'
            ) AS plan
     FROM users WHERE id = $1`,
    [userId]
  );

  if (!result.rows[0]) throw new Error('მომხმარებელი ვერ მოიძებნა');

  const { staging_uses_count, staging_uses_reset_at, plan } = result.rows[0];
  const limit = STAGING_LIMITS[plan] || STAGING_LIMITS.free;

  const now = new Date();
  const resetAt = staging_uses_reset_at ? new Date(staging_uses_reset_at) : null;

  if (!resetAt || now > resetAt) {
    await db.query(
      `UPDATE users SET staging_uses_count = 0,
       staging_uses_reset_at = NOW() + INTERVAL '30 days' WHERE id = $1`,
      [userId]
    );
    return { allowed: true, plan, remaining: limit, used: 0 };
  }

  const used = staging_uses_count || 0;
  if (used >= limit) {
    return {
      allowed: false,
      plan,
      remaining: 0,
      used,
      message: `${plan === 'free'
        ? `უფასო პლანზე ${limit} სტეიჯინგია. განახლება: Premium პლანი`
        : `ამ თვის ლიმიტი ამოიწურა (${limit})`}`,
    };
  }

  return { allowed: true, plan, remaining: limit - used, used };
};

const incrementStagingUsage = async (userId) => {
  await db.query(
    'UPDATE users SET staging_uses_count = COALESCE(staging_uses_count, 0) + 1 WHERE id = $1',
    [userId]
  );
};

// ─── Download image and upload to our S3 ─────────────────────────

const downloadAndStore = async (imageUrl, listingId) => {
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error('სურათის ჩამოტვირთვა ვერ მოხერხდა');

  const buffer = Buffer.from(await response.arrayBuffer());
  const key = `listings/${listingId}/staged/${uuidv4()}.jpg`;

  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: 'image/jpeg',
  }));

  const endpoint = process.env.S3_ENDPOINT || '';
  const bucket = process.env.S3_BUCKET_NAME;
  return `${endpoint}/${bucket}/${key}`;
};

// ─── GENERATE VIRTUAL STAGING ─────────────────────────────────────

const generateStaging = async (req, res) => {
  try {
    const userId = req.user.id;
    const { listing_id } = req.params;
    const {
      photo_id,
      room_type = 'living_room',
      style = 'modern',
      variations = 1,
    } = req.body;

    // Validate inputs
    if (!ROOM_TYPES.includes(room_type)) {
      return res.status(400).json({
        error: 'არასწორი ოთახის ტიპი',
        available: ROOM_TYPES,
      });
    }
    if (!ROOM_STYLES.includes(style)) {
      return res.status(400).json({
        error: 'არასწორი სტილი',
        available: ROOM_STYLES,
      });
    }

    // Check usage limit
    const usage = await checkStagingUsage(userId);
    if (!usage.allowed) {
      return res.status(403).json({ error: usage.message, plan: usage.plan });
    }

    // Verify listing ownership
    const listing = await db.query(
      'SELECT user_id FROM listings WHERE id = $1', [listing_id]
    );
    if (!listing.rows[0]) {
      return res.status(404).json({ error: 'განცხადება ვერ მოიძებნა' });
    }
    if (listing.rows[0].user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'წვდომა შეზღუდულია' });
    }

    // Get source photo
    let sourceUrl;
    if (photo_id) {
      const photo = await db.query(
        'SELECT url FROM listing_media WHERE id = $1 AND listing_id = $2',
        [photo_id, listing_id]
      );
      if (!photo.rows[0]) return res.status(404).json({ error: 'ფოტო ვერ მოიძებნა' });
      sourceUrl = photo.rows[0].url;
    } else {
      // Use cover photo
      const cover = await db.query(
        'SELECT url FROM listing_media WHERE listing_id = $1 AND is_cover = true LIMIT 1',
        [listing_id]
      );
      if (!cover.rows[0]) return res.status(400).json({ error: 'ფოტო ვერ მოიძებნა' });
      sourceUrl = cover.rows[0].url;
    }

    // Save staging job to DB (pending)
    const jobId = uuidv4();
    await db.query(
      `INSERT INTO staging_jobs
       (id, listing_id, user_id, source_url, room_type, style, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'processing')`,
      [jobId, listing_id, userId, sourceUrl, room_type, style]
    );

    // Call Decor8 AI API
    const decor8Response = await fetch(`${DECOR8_API}/generate_inspirational_designs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DECOR8_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        room_type,
        design_style: style,
        num_images: Math.min(variations, 4),
        input_image_url: sourceUrl,
        scale_factor: 1,
      }),
    });

    if (!decor8Response.ok) {
      const err = await decor8Response.json();
      await db.query(
        `UPDATE staging_jobs SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        [jobId]
      );
      return res.status(502).json({ error: 'AI სტეიჯინგის შეცდომა', detail: err });
    }

    const decor8Data = await decor8Response.json();

    // Download results and store on our S3
    const generatedImages = decor8Data.info?.images || [];
    const storedUrls = [];

    for (const img of generatedImages) {
      if (img.url) {
        const storedUrl = await downloadAndStore(img.url, listing_id);
        storedUrls.push(storedUrl);

        // Add to listing_media as staged photo
        await db.query(
          `INSERT INTO listing_media (listing_id, url, order_index, is_staged)
           VALUES ($1, $2,
             (SELECT COALESCE(MAX(order_index), 0) + 1 FROM listing_media WHERE listing_id = $1),
             true)`,
          [listing_id, storedUrl]
        );
      }
    }

    // Update job status
    await db.query(
      `UPDATE staging_jobs
       SET status = 'done', result_urls = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(storedUrls), jobId]
    );

    await incrementStagingUsage(userId);

    return res.json({
      job_id: jobId,
      status: 'done',
      images: storedUrls,
      room_type,
      style,
      staging_remaining: usage.remaining - 1,
    });
  } catch (err) {
    console.error('generateStaging error:', err);
    return res.status(500).json({ error: 'სტეიჯინგის შეცდომა' });
  }
};

// ─── GET STAGING HISTORY ──────────────────────────────────────────

const getStagingHistory = async (req, res) => {
  try {
    const { listing_id } = req.params;
    const userId = req.user.id;

    const result = await db.query(
      `SELECT id, room_type, style, status, result_urls, created_at
       FROM staging_jobs
       WHERE listing_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [listing_id, userId]
    );

    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

// ─── GET STAGING OPTIONS ──────────────────────────────────────────

const getStagingOptions = async (req, res) => {
  return res.json({ styles: ROOM_STYLES, room_types: ROOM_TYPES });
};

// ─── GET STAGING USAGE ────────────────────────────────────────────

const getStagingUsage = async (req, res) => {
  try {
    const usage = await checkStagingUsage(req.user.id);
    const result = await db.query(
      'SELECT staging_uses_count, staging_uses_reset_at FROM users WHERE id = $1',
      [req.user.id]
    );
    return res.json({
      plan: usage.plan,
      limit: STAGING_LIMITS[usage.plan],
      used: result.rows[0]?.staging_uses_count || 0,
      remaining: usage.remaining,
      reset_at: result.rows[0]?.staging_uses_reset_at,
    });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

module.exports = {
  generateStaging, getStagingHistory,
  getStagingOptions, getStagingUsage,
};
