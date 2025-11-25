import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const SALT_ROUNDS = 10;
const JWT_EXPIRES_IN = '7d'; // 7 days

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password) {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compare a plain text password with a hashed password
 */
export async function comparePassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

/**
 * Generate a JWT token for a user
 */
export function generateToken(userIdOrPayload, email) {
  // If first argument is an object, use it as the full payload
  const payload = typeof userIdOrPayload === 'object'
    ? userIdOrPayload
    : { userId: userIdOrPayload, email };

  const secret = process.env.JWT_SECRET || 'your-secret-key-change-this';

  return jwt.sign(
    payload,
    secret,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Verify a JWT token
 */
export function verifyToken(token) {
  const secret = process.env.JWT_SECRET || 'your-secret-key-change-this';
  try {
    return jwt.verify(token, secret);
  } catch (err) {
    return null;
  }
}
