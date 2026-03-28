const db = require('../config/database');

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';

// ─── Search tool definition for Claude ───────────────────────────

const SEARCH_TOOL = {
  name: 'search_listings',
  description: 'Search real estate listings based on user requirements. Use this whenever the user is looking for a property.',
  input_schema: {
    type: 'object',
    properties: {
      deal_type: {
        type: 'string',
        enum: ['sale', 'rent', 'daily_rent'],
        description: 'Type of deal',
      },
      property_type: {
        type: 'string',
        enum: ['apartment', 'house', 'commercial', 'land', 'hotel', 'garage'],
        description: 'Type of property',
      },
      city_slug: {
        type: 'string',
        description: 'City slug e.g. tbilisi, batumi, kutaisi',
      },
      district_slug: {
        type: 'string',
        description: 'District slug e.g. vake, saburtalo, isani',
      },
      price_min: { type: 'number', description: 'Minimum price in USD' },
      price_max: { type: 'number', description: 'Maximum price in USD' },
      area_min:  { type: 'number', description: 'Minimum area in m²' },
      area_max:  { type: 'number', description: 'Maximum area in m²' },
      rooms:     { type: 'number', description: 'Number of rooms' },
      floor_min: { type: 'number', description: 'Minimum floor' },
      floor_max: { type: 'number', description: 'Maximum floor' },
      has_3d_tour: {
        type: 'boolean',
        description: 'Only show listings with 3D virtual tour',
      },
      features: {
        type: 'array',
        items: { type: 'string' },
        description: 'Required features e.g. ["parking", "elevator", "balcony"]',
      },
    },
    required: [],
  },
};

// ─── Execute tool: search listings ───────────────────────────────

const executeSearchTool = async (toolInput) => {
  try {
    const conditions = [`l.status = 'active'`];
    const values = [];
    let idx = 1;

    if (toolInput.deal_type) {
      conditions.push(`l.deal_type = $${idx++}`);
      values.push(toolInput.deal_type);
    }
    if (toolInput.property_type) {
      conditions.push(`l.property_type = $${idx++}`);
      values.push(toolInput.property_type);
    }
    if (toolInput.city_slug) {
      conditions.push(`c.slug = $${idx++}`);
      values.push(toolInput.city_slug);
    }
    if (toolInput.district_slug) {
      conditions.push(`d.slug = $${idx++}`);
      values.push(toolInput.district_slug);
    }
    if (toolInput.price_min) {
      conditions.push(`l.price >= $${idx++}`);
      values.push(toolInput.price_min);
    }
    if (toolInput.price_max) {
      conditions.push(`l.price <= $${idx++}`);
      values.push(toolInput.price_max);
    }
    if (toolInput.area_min) {
      conditions.push(`l.area_total >= $${idx++}`);
      values.push(toolInput.area_min);
    }
    if (toolInput.area_max) {
      conditions.push(`l.area_total <= $${idx++}`);
      values.push(toolInput.area_max);
    }
    if (toolInput.rooms) {
      conditions.push(`l.rooms = $${idx++}`);
      values.push(toolInput.rooms);
    }
    if (toolInput.floor_min) {
      conditions.push(`l.floor >= $${idx++}`);
      values.push(toolInput.floor_min);
    }
    if (toolInput.floor_max) {
      conditions.push(`l.floor <= $${idx++}`);
      values.push(toolInput.floor_max);
    }
    if (toolInput.has_3d_tour) {
      conditions.push(`l.tour_3d_url IS NOT NULL`);
    }

    const where = conditions.join(' AND ');

    const result = await db.query(
      `SELECT
        l.id, l.slug, l.deal_type, l.property_type,
        l.price, l.price_currency, l.area_total, l.rooms,
        l.floor, l.floors_total, l.condition,
        l.title_ka, l.title_en, l.description_ka, l.description_en,
        l.tour_3d_url, l.views_count,
        c.name_ka AS city_ka, c.name_en AS city_en,
        d.name_ka AS district_ka, d.name_en AS district_en,
        l.is_boosted, l.is_vip,
        (SELECT url FROM listing_media
         WHERE listing_id = l.id AND is_cover = true LIMIT 1) AS cover_url,
        (SELECT COUNT(*) FROM listing_media WHERE listing_id = l.id) AS photo_count,
        (SELECT json_agg(f.name_en)
         FROM listing_features lf
         JOIN features f ON f.id = lf.feature_id
         WHERE lf.listing_id = l.id) AS features
       FROM listings l
       LEFT JOIN cities c ON l.city_id = c.id
       LEFT JOIN districts d ON l.district_id = d.id
       WHERE ${where}
       ORDER BY l.is_vip DESC, l.is_boosted DESC, l.published_at DESC
       LIMIT 5`,
      values
    );

    if (result.rows.length === 0) {
      return { found: 0, message: 'No listings found matching the criteria', listings: [] };
    }

    return {
      found: result.rows.length,
      listings: result.rows.map(l => ({
        id: l.id,
        slug: l.slug,
        url: `/listings/${l.slug}`,
        deal_type: l.deal_type,
        property_type: l.property_type,
        price: `${l.price} ${l.price_currency}`,
        area: l.area_total ? `${l.area_total} m²` : null,
        rooms: l.rooms,
        floor: l.floor && l.floors_total ? `${l.floor}/${l.floors_total}` : null,
        condition: l.condition,
        location: [l.district_ka, l.city_ka].filter(Boolean).join(', '),
        title: l.title_ka || l.title_en,
        description: (l.description_ka || l.description_en || '').substring(0, 200),
        has_3d_tour: !!l.tour_3d_url,
        tour_url: l.tour_3d_url || null,
        cover_url: l.cover_url,
        photos: l.photo_count,
        features: l.features || [],
        is_vip: l.is_vip,
      })),
    };
  } catch (err) {
    console.error('executeSearchTool error:', err);
    return { error: 'Search failed', listings: [] };
  }
};

// ─── System prompt ────────────────────────────────────────────────

const SYSTEM_PROMPT = `შენ ხარ PropTech GE-ს AI ასისტენტი — საქართველოს უძრავი ქონების პლატფორმა.
შენი სახელია "პროპი" და შენ ეხმარები მომხმარებლებს უძრავი ქონების პოვნაში.

მთავარი წესები:
1. ყოველთვის ქართულად პასუხობ (თუ მომხმარებელი ინგლისურად წერს — ინგლისურად)
2. search_listings tool-ს იყენებ ყოველთვის, როცა ვინმე ეძებს ქონებას
3. შედეგებს ლამაზად წარადგენ: ფასი, ფართი, მდებარეობა, მახასიათებლები
4. 3D ტური თუ აქვს — განსაკუთრებით გამოკვეთ
5. მაქსიმუმ 5 განცხადება გასცე ერთდროულად
6. თუ ძიება ვერ იძებნა შედეგს — კეთილგანწყობილად მოითხოვე კრიტერიუმების შეცვლა
7. ბიუჯეტი, ოთახები, რაიონი — ეს სამი ველი ყოველთვის ამოიკვეთე საუბრიდან

შენ არ:
- განიხილავ პოლიტიკას, რელიგიას ან სხვა არარელევანტურ თემებს
- იძლევი იურიდიულ ან ფინანსურ რჩევას
- ამჟღავნებ სხვა მომხმარებლების ინფორმაციას`;

// ─── CHAT ENDPOINT ────────────────────────────────────────────────

const chat = async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'შეტყობინება ცარიელია' });
    }

    // Build messages array (max last 10 turns for context)
    const recentHistory = history.slice(-20);
    const messages = [
      ...recentHistory,
      { role: 'user', content: message },
    ];

    // First call to Claude
    let response = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        tools: [SEARCH_TOOL],
        messages,
      }),
    });

    let data = await response.json();

    // Handle tool use (agentic loop)
    let toolResults = [];
    let finalText = '';

    if (data.stop_reason === 'tool_use') {
      const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');

      for (const toolUse of toolUseBlocks) {
        if (toolUse.name === 'search_listings') {
          const searchResult = await executeSearchTool(toolUse.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(searchResult),
          });
        }
      }

      // Second call with tool results
      const messagesWithTools = [
        ...messages,
        { role: 'assistant', content: data.content },
        { role: 'user', content: toolResults },
      ];

      response = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1500,
          system: SYSTEM_PROMPT,
          tools: [SEARCH_TOOL],
          messages: messagesWithTools,
        }),
      });

      data = await response.json();
    }

    // Extract final text
    const textBlock = data.content?.find(b => b.type === 'text');
    finalText = textBlock?.text || 'ბოდიში, პასუხი ვერ მოვამზადე';

    // Extract listing results from tool
    let listings = [];
    if (toolResults.length > 0) {
      try {
        const parsed = JSON.parse(toolResults[0].content);
        listings = parsed.listings || [];
      } catch {}
    }

    // Save conversation to DB (optional, for analytics)
    if (req.user?.id) {
      db.query(
        `INSERT INTO chat_logs (user_id, user_message, bot_response, listings_found)
         VALUES ($1, $2, $3, $4)`,
        [req.user.id, message, finalText, listings.length]
      ).catch(() => {});
    }

    return res.json({
      reply: finalText,
      listings,
      has_results: listings.length > 0,
    });
  } catch (err) {
    console.error('chat error:', err);
    return res.status(500).json({ error: 'AI სერვისის შეცდომა' });
  }
};

module.exports = { chat };
