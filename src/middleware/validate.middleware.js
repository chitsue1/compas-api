const Joi = require('joi');

const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: false });
  if (error) {
    const messages = error.details.map((d) => d.message);
    return res.status(400).json({ error: 'Validation error', details: messages });
  }
  next();
};

// ─── Auth schemas ─────────────────────────────────────────────────

const registerSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'სწორი Email შეიყვანეთ',
    'any.required': 'Email სავალდებულოა',
  }),
  phone: Joi.string().pattern(/^\+?[0-9]{9,15}$/).optional().messages({
    'string.pattern.base': 'სწორი ტელეფონის ნომერი შეიყვანეთ',
  }),
  password: Joi.string().min(8).required().messages({
    'string.min': 'პაროლი მინიმუმ 8 სიმბოლო უნდა იყოს',
    'any.required': 'პაროლი სავალდებულოა',
  }),
  first_name: Joi.string().max(100).optional(),
  last_name: Joi.string().max(100).optional(),
  role: Joi.string().valid('user', 'agent').optional(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const refreshSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

module.exports = {
  validate,
  registerSchema,
  loginSchema,
  refreshSchema,
};
