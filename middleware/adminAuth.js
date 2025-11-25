import { verifyToken } from "../utils/auth.js";

export const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.substring(7);

    try {
        const decoded = verifyToken(token);

        if (!decoded) {
            return res.status(401).json({ error: "Invalid token" });
        }

        // Check if this is an admin token (has adminId instead of userId)
        if (!decoded.adminId) {
            return res.status(403).json({ error: "Admin access required" });
        }

        req.admin = {
            adminId: decoded.adminId,
            email: decoded.email
        };

        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid token" });
    }
};
