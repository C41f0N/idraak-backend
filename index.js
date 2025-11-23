import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { hashPassword, comparePassword, generateToken } from "./utils/auth.js";
import { authenticateToken } from "./middleware/auth.js";
import { uploadIssueFiles } from "./middleware/upload.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const { Pool } = pkg;

const app = express();
const port = 3000;

// Parse JSON bodies
app.use(express.json());

// Create a connection pool to Postgres
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Test route
app.get("/", (req, res) => {
  res.json({ message: "API is running" });
});

// ============ AUTH ROUTES ============

// Check username availability
app.get("/auth/check-username", async (req, res) => {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  try {
    const result = await pool.query(
      "SELECT user_id FROM users WHERE username = $1",
      [username]
    );

    res.json({ available: result.rows.length === 0 });
  } catch (err) {
    console.error("Error checking username:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Register new user
app.post("/auth/register", async (req, res) => {
  const { email, password, username, full_name } = req.body;

  if (!email || !password || !username || !full_name) {
    return res.status(400).json({
      error: "Email, password, username, and full_name are required"
    });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  // Basic password validation
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    // Check if email or username already exists
    const existingUser = await pool.query(
      "SELECT user_id FROM users WHERE email = $1 OR username = $2",
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        error: "Email or username already exists"
      });
    }

    // Get the Citizen role_id
    const roleResult = await pool.query(
      "SELECT role_id FROM roles WHERE title = $1",
      ['Citizen']
    );

    if (roleResult.rows.length === 0) {
      return res.status(500).json({ error: "Default role not found" });
    }

    const citizenRoleId = roleResult.rows[0].role_id;

    // Hash password
    const password_hash = await hashPassword(password);

    // Insert new user with Citizen role
    const result = await pool.query(
      `INSERT INTO users (user_id, email, username, full_name, password_hash, role_id) 
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) 
       RETURNING user_id, email, username, full_name, role_id, created_at`,
      [email, username, full_name, password_hash, citizenRoleId]
    );

    const user = result.rows[0];

    // Generate JWT token
    const token = generateToken(user.user_id, user.email);

    res.status(201).json({
      token,
      user: {
        id: user.user_id,
        email: user.email,
        username: user.username,
        full_name: user.full_name,
        role_id: user.role_id,
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error("Error registering user:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Login user
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    // Find user by email
    const result = await pool.query(
      `SELECT user_id, email, username, full_name, password_hash, role_id, created_at 
       FROM users WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];

    // Compare password
    const isValid = await comparePassword(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Generate JWT token
    const token = generateToken(user.user_id, user.email);

    res.json({
      token,
      user: {
        id: user.user_id,
        email: user.email,
        username: user.username,
        full_name: user.full_name,
        role_id: user.role_id,
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error("Error logging in:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get current user (protected route)
app.get("/auth/me", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT user_id, email, username, full_name, role_id, created_at 
       FROM users WHERE user_id = $1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];
    res.json({
      user: {
        id: user.user_id,
        email: user.email,
        username: user.username,
        full_name: user.full_name,
        role_id: user.role_id,
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error("Error fetching user:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ USER ROUTES ============

// Example route: get all users (protected)
app.get("/users", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT user_id, username, email, full_name, role_id FROM users ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error querying users:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Example route: create a user (protected) - Use /auth/register instead for new users
app.post("/users", authenticateToken, async (req, res) => {
  const { username, email, full_name, password, role_id } = req.body;

  if (!username || !email || !full_name || !password) {
    return res.status(400).json({ error: "username, email, full_name and password are required" });
  }

  try {
    // Hash password
    const password_hash = await hashPassword(password);

    // Use Citizen role if not specified
    let finalRoleId = role_id;
    if (!finalRoleId) {
      const roleResult = await pool.query(
        "SELECT role_id FROM roles WHERE title = $1",
        ['Citizen']
      );
      finalRoleId = roleResult.rows[0]?.role_id;
    }

    const result = await pool.query(
      `INSERT INTO users (user_id, username, email, full_name, password_hash, role_id) 
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) 
       RETURNING user_id, username, email, full_name, role_id, created_at`,
      [username, email, full_name, password_hash, finalRoleId]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error inserting user:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
