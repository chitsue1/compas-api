const db = require('../config/database');

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

// ─── AI Usage limits per plan ─────────────────────────────────────
const AI_LIMITS = {
  free:     5,   // 5 total AI uses across all features
  standard: 999, // unlimited
  premium:  999,
  vip:      999,
};

// ─── Check & increment AI usage ───────────────────────────────────

const checkAiUsage = async (userId) => {
  const user = await db.query(
    `SELECT ai_uses_count, ai_uses_reset_at,
            COALESCE(
              (SELECT plan FROM payments
               WHERE user_id = users.id AND status = 'success'
               ORDER BY created_at DESC LIMIT 1),
              'free'
            ) AS plan
     FROM users WHERE id = $1`,
    [userId]
  );

  if (user.rows.length === 0) throw new Error('მომხმარებელი ვერ მოიძებნა');

  const { ai_uses_count, ai_uses_reset_at, plan } = user.rows[0];
  const limit = AI_LIMITS[plan] || AI_LIMITS.free;

  // Reset monthly counter if needed
  const now = new Date();
  const resetAt = ai_uses_reset_at ? new Date(ai_uses_reset_at) : null;
  if (!resetAt || now > resetAt) {
    await db.query(
      `UPDATE users SET ai_uses_count = 0,
       ai_uses_reset_at = NOW() + INTERVAL '30 days' WHERE id = $1`,
      [userId]
    );
    return { allowed: true, plan, remaining: limit };
  }

  if (plan === 'free' && ai_uses_count >= limit) {
    return {
      allowed: false,
      plan,
      remaining: 0,
      message: `უფასო პლანზე ${limit} AI გამოყენებაა. განახლება: Standard პლანი`,
    };
  }

  return { allowed: true, plan, remaining: limit - ai_uses_count };
};

const incrementAiUsage = async (userId) => {
  await db.query(
    'UPDATE users SET ai_uses_count = COALESCE(ai_uses_count, 0) + 1 WHERE id = $1',
    [userId]
  );
};

// ─── Claude API call helper ───────────────────────────────────────

const callClaude = async (messages, maxTokens = 1000) => {
  const response = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'Claude API შეცდომა');
  }

  const data = await response.json();
  return data.content[0].text;
};

// ─── 1. AI DESCRIPTION GENERATOR ─────────────────────────────────

const generateDescription = async (req, res) => {
  try {
    const userId = req.user.id;
    const usage = await checkAiUsage(userId);
    if (!usage.allowed) return res.status(403).json({ error: usage.message });

    const {
      deal_type, property_type, city, district,
      price, area_total, rooms, floor, floors_total,
      condition, features,
    } = req.body;

    const featureList = Array.isArray(features) ? features.join(', ') : '';

    const prompt = `შექმენი პროფესიონალური უძრავი ქონების განცხადების აღწერა ქართულად და ინგლისურად.

მონაცემები:
- ტიპი: ${property_type} (${deal_type})
- მდებარეობა: ${city}, ${district}
- ფასი: ${price}
- ფართი: ${area_total} მ²
- ოთახები: ${rooms}
- სართული: ${floor}/${floors_total}
- მდგომარეობა: ${condition}
- სარგებლობა: ${featureList}

დააბრუნე მხოლოდ JSON ფორმატში, სხვა არაფერი:
{
  "description_ka": "ქართული აღწერა (150-250 სიტყვა, მიმზიდველი და პროფესიონალური)",
  "description_en": "English description (150-250 words, professional and attractive)",
  "title_ka": "მოკლე სათაური ქართულად (მაქს 80 სიმბოლო)",
  "title_en": "Short title in English (max 80 chars)"
}`;

    const result = await callClaude([{ role: 'user', content: prompt }], 1500);
    await incrementAiUsage(userId);

    let parsed;
    try {
      const clean = result.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      return res.status(500).json({ error: 'AI პასუხის დამუშავების შეცდომა' });
    }

    return res.json({
      ...parsed,
      ai_uses_remaining: usage.remaining - 1,
    });
  } catch (err) {
    console.error('generateDescription error:', err);
    return res.status(500).json({ error: 'AI სერვისის შეცდომა' });
  }
};

// ─── 2. AI COVER PHOTO SELECTION ─────────────────────────────────

const selectCoverPhoto = async (req, res) => {
  try {
    const userId = req.user.id;
    const usage = await checkAiUsage(userId);
    if (!usage.allowed) return res.status(403).json({ error: usage.message });

    const { listing_id } = req.params;

    // Get listing photos
    const photos = await db.query(
      `SELECT id, url FROM listing_media WHERE listing_id = $1 ORDER BY order_index ASC LIMIT 10`,
      [listing_id]
    );

    if (photos.rows.length === 0) {
      return res.status(400).json({ error: 'ფოტოები ვერ მოიძებნა' });
    }

    if (photos.rows.length === 1) {
      return res.json({ cover_id: photos.rows[0].id, ai_uses_remaining: usage.remaining });
    }

    // Build vision message with photo URLs
    const imageContent = photos.rows.map((photo, idx) => ([
      {
        type: 'text',
        text: `ფოტო ${idx + 1} (ID: ${photo.id}):`,
      },
      {
        type: 'image',
        source: { type: 'url', url: photo.url },
      },
    ])).flat();

    imageContent.push({
      type: 'text',
      text: `რომელი ფოტო არის ყველაზე შესაფერისი განცხადების მთავარ ფოტოდ?
გაითვალისწინე: სიმკვეთრე, განათება, კომპოზიცია, ბინის საუკეთესო წარმოჩენა.
დააბრუნე მხოლოდ JSON: {"cover_id": "ფოტოს_ID", "reason": "მოკლე მიზეზი"}`,
    });

    const result = await callClaude([{ role: 'user', content: imageContent }], 200);
    await incrementAiUsage(userId);

    let parsed;
    try {
      const clean = result.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      // Fallback: first photo
      parsed = { cover_id: photos.rows[0].id };
    }

    // Apply cover
    if (parsed.cover_id) {
      await db.query('UPDATE listing_media SET is_cover = false WHERE listing_id = $1', [listing_id]);
      await db.query(
        'UPDATE listing_media SET is_cover = true WHERE id = $1 AND listing_id = $2',
        [parsed.cover_id, listing_id]
      );
    }

    return res.json({ ...parsed, ai_uses_remaining: usage.remaining - 1 });
  } catch (err) {
    console.error('selectCoverPhoto error:', err);
    return res.status(500).json({ error: 'AI სერვისის შეცდომა' });
  }
};

// ─── 3. AI AUTO-TAGGING ───────────────────────────────────────────

const autoTag = async (req, res) => {
  try {
    const userId = req.user.id;
    const usage = await checkAiUsage(userId);
    if (!usage.allowed) return res.status(403).json({ error: usage.message });

    const { listing_id } = req.params;

    // Get photos + available features
    const [photos, features] = await Promise.all([
      db.query(
        `SELECT url FROM listing_media WHERE listing_id = $1 ORDER BY order_index ASC LIMIT 8`,
        [listing_id]
      ),
      db.query(`SELECT id, name_ka, name_en FROM features ORDER BY id`),
    ]);

    if (photos.rows.length === 0) {
      return res.status(400).json({ error: 'ფოტოები ვერ მოიძებნა' });
    }

    const featureList = features.rows
      .map(f => `${f.id}: ${f.name_ka} (${f.name_en})`)
      .join('\n');

    const imageContent = photos.rows.slice(0, 5).map((photo) => ([
      { type: 'image', source: { type: 'url', url: photo.url } },
    ])).flat();

    imageContent.push({
      type: 'text',
      text: `ამ ფოტოებიდან ამოიცანი რომელი მახასიათებლები ჩანს:

${featureList}

დააბრუნე მხოლოდ JSON: {"feature_ids": [1, 2, 3, ...]}
მხოლოდ ის ID-ები, რომლებიც ნამდვილად ჩანს ფოტოებში.`,
    });

    const result = await callClaude([{ role: 'user', content: imageContent }], 300);
    await incrementAiUsage(userId);

    let parsed;
    try {
      const clean = result.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = { feature_ids: [] };
    }

    // Apply tags to listing
    if (parsed.feature_ids && parsed.feature_ids.length > 0) {
      const values = parsed.feature_ids
        .map(id => `('${listing_id}', ${parseInt(id)})`)
        .join(', ');
      await db.query(
        `INSERT INTO listing_features (listing_id, feature_id) VALUES ${values}
         ON CONFLICT DO NOTHING`
      );
    }

    // Return with names
    const taggedFeatures = features.rows.filter(f =>
      (parsed.feature_ids || []).includes(f.id)
    );

    return res.json({
      feature_ids: parsed.feature_ids || [],
      features: taggedFeatures,
      ai_uses_remaining: usage.remaining - 1,
    });
  } catch (err) {
    console.error('autoTag error:', err);
    return res.status(500).json({ error: 'AI სერვისის შეცდომა' });
  }
};

// ─── 4. GET AI USAGE STATUS ───────────────────────────────────────

const getAiUsage = async (req, res) => {
  try {
    const userId = req.user.id;
    const usage = await checkAiUsage(userId);
    const result = await db.query(
      'SELECT ai_uses_count, ai_uses_reset_at FROM users WHERE id = $1',
      [userId]
    );
    return res.json({
      plan: usage.plan,
      limit: AI_LIMITS[usage.plan],
      used: result.rows[0]?.ai_uses_count || 0,
      remaining: usage.remaining,
      reset_at: result.rows[0]?.ai_uses_reset_at,
    });
  } catch (err) {
    return res.status(500).json({ error: 'სერვერის შეცდომა' });
  }
};

module.exports = { generateDescription, selectCoverPhoto, autoTag, getAiUsage };
