const Joi = require('joi');

const createListingSchema = Joi.object({
  deal_type: Joi.string().valid('sale', 'rent', 'daily_rent').required().messages({
    'any.required': 'გარიგების ტიპი სავალდებულოა',
    'any.only': 'გარიგების ტიპი: sale, rent, daily_rent',
  }),
  property_type: Joi.string()
    .valid('apartment', 'house', 'commercial', 'land', 'hotel', 'garage')
    .required()
    .messages({ 'any.required': 'ობიექტის ტიპი სავალდებულოა' }),

  city_id: Joi.number().integer().optional(),
  district_id: Joi.number().integer().optional(),
  street_id: Joi.number().integer().optional(),
  address_detail: Joi.string().max(300).optional(),
  latitude: Joi.number().min(-90).max(90).optional(),
  longitude: Joi.number().min(-180).max(180).optional(),

  price: Joi.number().positive().required().messages({
    'any.required': 'ფასი სავალდებულოა',
    'number.positive': 'ფასი დადებითი რიცხვი უნდა იყოს',
  }),
  price_currency: Joi.string().valid('USD', 'GEL', 'EUR').default('USD'),
  negotiable: Joi.boolean().default(false),

  area_total: Joi.number().positive().optional(),
  area_living: Joi.number().positive().optional(),
  area_kitchen: Joi.number().positive().optional(),
  floor: Joi.number().integer().min(-5).max(200).optional(),
  floors_total: Joi.number().integer().min(1).max(200).optional(),
  rooms: Joi.number().integer().min(0).max(50).optional(),
  bedrooms: Joi.number().integer().min(0).max(50).optional(),
  bathrooms: Joi.number().integer().min(0).max(20).optional(),
  condition: Joi.string()
    .valid('new', 'renovated', 'old', 'under_construction', 'black_frame', 'white_frame', 'green_frame')
    .optional(),

  title_ka: Joi.string().max(300).optional(),
  title_en: Joi.string().max(300).optional(),
  description_ka: Joi.string().max(5000).optional(),
  description_en: Joi.string().max(5000).optional(),

  tour_3d_url: Joi.string().uri().max(500).optional(),
  video_url: Joi.string().uri().max(500).optional(),

  features: Joi.array().items(Joi.number().integer()).optional(),
});

const updateListingSchema = createListingSchema.fork(
  ['deal_type', 'property_type', 'price'],
  (schema) => schema.optional()
);

module.exports = { createListingSchema, updateListingSchema };
