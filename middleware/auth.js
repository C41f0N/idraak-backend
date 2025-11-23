import { verifyToken } from '../utils/auth.js';

/**
 * Middleware to verify JWT token from Authorization header
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  const decoded = verifyToken(token);

  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  // Attach user info to request
  req.user = decoded;
  next();
}
