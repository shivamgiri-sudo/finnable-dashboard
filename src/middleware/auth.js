'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { config } = require('../config');

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function login(pin) {
  if (!safeEqual(pin, config.dashboardPin)) {
    const error = new Error('Invalid dashboard access PIN.');
    error.statusCode = 401;
    throw error;
  }
  const token = jwt.sign(
    { role: 'finnable-dashboard', clientScope: config.defaultClientId },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn, issuer: 'finnable-intelligence-api' }
  );
  return {
    success: true,
    token,
    title: 'Finnable Sales & Quality Intelligence Command Center',
    defaultClientId: config.defaultClientId
  };
}

function requireAuth(req, res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ message: 'Authentication required.' });
  try {
    req.user = jwt.verify(token, config.jwtSecret, { issuer: 'finnable-intelligence-api' });
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Session expired. Please sign in again.' });
  }
}

module.exports = { login, requireAuth };
