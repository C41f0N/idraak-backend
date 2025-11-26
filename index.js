import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { hashPassword, comparePassword, generateToken } from "./utils/auth.js";
import { authenticateToken } from "./middleware/auth.js";
import { authenticateAdmin } from "./middleware/adminAuth.js";
import { uploadIssueFiles } from "./middleware/upload.js";
import { uploadToSupabase, deleteFromSupabase, generateUniqueFileName, getSignedUrl, enrichWithSignedUrls } from "./utils/supabase.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();
const { Pool } = pkg;

const app = express();
const port = 3000;

// Parse JSON bodies
app.use(express.json());

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// ============ ADMIN ROUTES ============

// Admin login
app.post("/admin/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const result = await pool.query(
      'SELECT admin_id, email, first_name, last_name, password_hash FROM admin WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const admin = result.rows[0];
    const isValid = await comparePassword(password, admin.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Generate JWT token with adminId
    const token = generateToken({
      adminId: admin.admin_id,
      email: admin.email
    });

    res.json({
      token,
      admin: {
        id: admin.admin_id,
        email: admin.email,
        firstName: admin.first_name,
        lastName: admin.last_name
      }
    });
  } catch (err) {
    console.error("Error logging in admin:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create a new role (admin only)
app.post("/admin/roles", authenticateAdmin, async (req, res) => {
  const { title, description, upvote_weight } = req.body;

  if (!title || upvote_weight === undefined) {
    return res.status(400).json({ error: "Title and upvote_weight are required" });
  }

  if (upvote_weight < 1 || !Number.isInteger(upvote_weight)) {
    return res.status(400).json({ error: "Upvote weight must be a positive integer" });
  }

  try {
    // Check if role title already exists
    const existing = await pool.query(
      'SELECT role_id FROM roles WHERE title = $1',
      [title]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Role with this title already exists" });
    }

    const result = await pool.query(
      'INSERT INTO roles (title, description, upvote_weight) VALUES ($1, $2, $3) RETURNING role_id, title, description, upvote_weight',
      [title, description || null, upvote_weight]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error creating role:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all roles (admin only)
app.get("/admin/roles", authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT role_id, title, description, upvote_weight FROM roles ORDER BY upvote_weight ASC'
    );

    res.json({ roles: result.rows });
  } catch (err) {
    console.error("Error fetching roles:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update a role (admin only)
app.put("/admin/roles/:id", authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const { title, description, upvote_weight } = req.body;

  if (!title && !description && upvote_weight === undefined) {
    return res.status(400).json({ error: "At least one field to update is required" });
  }

  if (upvote_weight !== undefined && (upvote_weight < 1 || !Number.isInteger(upvote_weight))) {
    return res.status(400).json({ error: "Upvote weight must be a positive integer" });
  }

  try {
    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (title) {
      updates.push(`title = $${paramCount++}`);
      values.push(title);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (upvote_weight !== undefined) {
      updates.push(`upvote_weight = $${paramCount++}`);
      values.push(upvote_weight);
    }

    values.push(id);

    const result = await pool.query(
      `UPDATE roles SET ${updates.join(', ')} WHERE role_id = $${paramCount} RETURNING role_id, title, description, upvote_weight`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Role not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating role:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete a role (admin only)
app.delete("/admin/roles/:id", authenticateAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    // Check if role exists
    const roleCheck = await pool.query(
      'SELECT title FROM roles WHERE role_id = $1',
      [id]
    );

    if (roleCheck.rows.length === 0) {
      return res.status(404).json({ error: "Role not found" });
    }

    // Prevent deletion of Citizen role
    if (roleCheck.rows[0].title === 'Citizen') {
      return res.status(400).json({ error: "Cannot delete the default Citizen role" });
    }

    // Check if role is assigned to any users
    const usersWithRole = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE role_id = $1',
      [id]
    );

    if (parseInt(usersWithRole.rows[0].count) > 0) {
      return res.status(400).json({
        error: "Cannot delete role that is assigned to users",
        users_count: parseInt(usersWithRole.rows[0].count)
      });
    }

    await pool.query('DELETE FROM roles WHERE role_id = $1', [id]);

    res.json({ message: "Role deleted successfully" });
  } catch (err) {
    console.error("Error deleting role:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ USER ROLE ROUTES ============

// Get all available roles (for users to see what they can request)
app.get("/roles", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT role_id, title, description, upvote_weight FROM roles ORDER BY upvote_weight ASC'
    );

    res.json({ roles: result.rows });
  } catch (err) {
    console.error("Error fetching roles:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Submit a role change request
app.post("/role-change-request", authenticateToken, async (req, res) => {
  const { requested_role_id } = req.body;
  const userId = req.user.userId;

  if (!requested_role_id) {
    return res.status(400).json({ error: "requested_role_id is required" });
  }

  try {
    // Check if role exists
    const roleCheck = await pool.query(
      'SELECT role_id FROM roles WHERE role_id = $1',
      [requested_role_id]
    );

    if (roleCheck.rows.length === 0) {
      return res.status(404).json({ error: "Role not found" });
    }

    // Check if user already has this role
    const userRole = await pool.query(
      'SELECT role_id FROM users WHERE user_id = $1',
      [userId]
    );

    if (userRole.rows[0].role_id === requested_role_id) {
      return res.status(400).json({ error: "You already have this role" });
    }

    // Check if there's already a pending request
    const existingRequest = await pool.query(
      'SELECT req_id FROM role_change_request WHERE user_id = $1 AND requested_role_id = $2 AND status = $3',
      [userId, requested_role_id, 'pending']
    );

    if (existingRequest.rows.length > 0) {
      return res.status(400).json({ error: "You already have a pending request for this role" });
    }

    const result = await pool.query(
      'INSERT INTO role_change_request (user_id, requested_role_id) VALUES ($1, $2) RETURNING req_id, user_id, requested_role_id, status, submitted_at',
      [userId, requested_role_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error submitting role change request:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get user's role change requests
app.get("/role-change-requests", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT rcr.req_id, rcr.user_id, rcr.requested_role_id, rcr.status, rcr.submitted_at, rcr.reviewed_at,
              r.title as role_title, r.description as role_description, r.upvote_weight
       FROM role_change_request rcr
       JOIN roles r ON rcr.requested_role_id = r.role_id
       WHERE rcr.user_id = $1
       ORDER BY rcr.submitted_at DESC`,
      [userId]
    );

    res.json({ requests: result.rows });
  } catch (err) {
    console.error("Error fetching role change requests:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ ADMIN ROUTES ============

// Admin login
app.post("/admin/auth/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const result = await pool.query(
      'SELECT admin_id, email, first_name, last_name, password_hash FROM admin WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const admin = result.rows[0];
    const isValid = await comparePassword(password, admin.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Generate JWT token with adminId
    const token = generateToken({ adminId: admin.admin_id, email: admin.email });

    res.json({
      token,
      admin: {
        id: admin.admin_id,
        email: admin.email,
        firstName: admin.first_name,
        lastName: admin.last_name
      }
    });
  } catch (err) {
    console.error("Error logging in admin:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create a new role (admin only)
app.post("/admin/roles", authenticateAdmin, async (req, res) => {
  const { title, description, upvote_weight } = req.body;

  if (!title || upvote_weight === undefined) {
    return res.status(400).json({ error: "Title and upvote_weight are required" });
  }

  if (upvote_weight < 1 || !Number.isInteger(upvote_weight)) {
    return res.status(400).json({ error: "Upvote weight must be a positive integer" });
  }

  try {
    // Check if role title already exists
    const existing = await pool.query(
      'SELECT role_id FROM roles WHERE title = $1',
      [title]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Role with this title already exists" });
    }

    const result = await pool.query(
      'INSERT INTO roles (title, description, upvote_weight) VALUES ($1, $2, $3) RETURNING role_id, title, description, upvote_weight',
      [title, description || null, upvote_weight]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error creating role:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all roles (admin only)
app.get("/admin/roles", authenticateAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT role_id, title, description, upvote_weight FROM roles ORDER BY upvote_weight ASC'
    );

    res.json({ roles: result.rows });
  } catch (err) {
    console.error("Error fetching roles:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update a role (admin only)
app.put("/admin/roles/:id", authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const { title, description, upvote_weight } = req.body;

  if (!title && !description && upvote_weight === undefined) {
    return res.status(400).json({ error: "At least one field to update is required" });
  }

  if (upvote_weight !== undefined && (upvote_weight < 1 || !Number.isInteger(upvote_weight))) {
    return res.status(400).json({ error: "Upvote weight must be a positive integer" });
  }

  try {
    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (title) {
      updates.push(`title = $${paramCount++}`);
      values.push(title);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (upvote_weight !== undefined) {
      updates.push(`upvote_weight = $${paramCount++}`);
      values.push(upvote_weight);
    }

    values.push(id);

    const result = await pool.query(
      `UPDATE roles SET ${updates.join(', ')} WHERE role_id = $${paramCount} RETURNING role_id, title, description, upvote_weight`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Role not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating role:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete a role (admin only)
app.delete("/admin/roles/:id", authenticateAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    // Check if role exists
    const roleCheck = await pool.query(
      'SELECT title FROM roles WHERE role_id = $1',
      [id]
    );

    if (roleCheck.rows.length === 0) {
      return res.status(404).json({ error: "Role not found" });
    }

    // Prevent deletion of Citizen role
    if (roleCheck.rows[0].title === 'Citizen') {
      return res.status(400).json({ error: "Cannot delete the default Citizen role" });
    }

    // Check if role is assigned to any users
    const usersWithRole = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE role_id = $1',
      [id]
    );

    if (parseInt(usersWithRole.rows[0].count) > 0) {
      return res.status(400).json({
        error: "Cannot delete role that is assigned to users",
        users_count: parseInt(usersWithRole.rows[0].count)
      });
    }

    await pool.query('DELETE FROM roles WHERE role_id = $1', [id]);

    res.json({ message: "Role deleted successfully" });
  } catch (err) {
    console.error("Error deleting role:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ USER ROLE ROUTES ============

// Get all available roles (for users to see what they can request)
app.get("/roles", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT role_id, title, description, upvote_weight FROM roles ORDER BY upvote_weight ASC'
    );

    res.json({ roles: result.rows });
  } catch (err) {
    console.error("Error fetching roles:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Submit a role change request
app.post("/role-change-request", authenticateToken, async (req, res) => {
  const { requested_role_id } = req.body;
  const userId = req.user.userId;

  if (!requested_role_id) {
    return res.status(400).json({ error: "requested_role_id is required" });
  }

  try {
    // Check if role exists
    const roleCheck = await pool.query(
      'SELECT role_id FROM roles WHERE role_id = $1',
      [requested_role_id]
    );

    if (roleCheck.rows.length === 0) {
      return res.status(404).json({ error: "Role not found" });
    }

    // Check if user already has this role
    const userRole = await pool.query(
      'SELECT role_id FROM users WHERE user_id = $1',
      [userId]
    );

    if (userRole.rows[0].role_id === requested_role_id) {
      return res.status(400).json({ error: "You already have this role" });
    }

    // Check if there's already a pending request
    const existingRequest = await pool.query(
      'SELECT req_id FROM role_change_request WHERE user_id = $1 AND requested_role_id = $2 AND status = $3',
      [userId, requested_role_id, 'pending']
    );

    if (existingRequest.rows.length > 0) {
      return res.status(400).json({ error: "You already have a pending request for this role" });
    }

    const result = await pool.query(
      'INSERT INTO role_change_request (user_id, requested_role_id) VALUES ($1, $2) RETURNING req_id, user_id, requested_role_id, status, submitted_at',
      [userId, requested_role_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error submitting role change request:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get user's role change requests
app.get("/role-change-requests", authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT rcr.req_id, rcr.user_id, rcr.requested_role_id, rcr.status, rcr.submitted_at, rcr.reviewed_at,
              r.title as role_title, r.description as role_description, r.upvote_weight
       FROM role_change_request rcr
       JOIN roles r ON rcr.requested_role_id = r.role_id
       WHERE rcr.user_id = $1
       ORDER BY rcr.submitted_at DESC`,
      [userId]
    );

    res.json({ requests: result.rows });
  } catch (err) {
    console.error("Error fetching role change requests:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ ISSUE ROUTES ============



// Create a new issue with optional display picture and attachments
app.post("/issues", authenticateToken, (req, res) => {
  uploadIssueFiles(req, res, async (err) => {
    if (err) {
      console.error("Upload error:", err);
      return res.status(400).json({ error: err.message });
    }

    const uploadedFiles = [];
    let issue = null;

    try {
      const { title, description, group_id } = req.body;
      const userId = req.user.userId;

      if (!title || !description) {
        return res.status(400).json({ error: "Title and description are required" });
      }

      // Create issue first
      const issueResult = await pool.query(
        `INSERT INTO issues (title, description, user_id, group_id, display_picture_url, upvote_count, comment_count)
         VALUES ($1, $2, $3, $4, $5, 0, 0)
         RETURNING issue_id, title, description, user_id, group_id, display_picture_url, upvote_count, comment_count, posted_at`,
        [title, description, userId, group_id || null, null]
      );

      issue = issueResult.rows[0];

      // Upload display picture if provided
      const displayPictures = req.files?.['display_picture'];
      if (displayPictures && displayPictures[0]) {
        const file = displayPictures[0];
        const fileName = generateUniqueFileName(file.originalname, 'issue');

        const { storagePath } = await uploadToSupabase({
          bucket: 'uploads',
          folder: 'issues',
          file: file.buffer,
          fileName,
          contentType: file.mimetype
        });

        uploadedFiles.push({ bucket: 'uploads', path: storagePath });

        await pool.query(
          `UPDATE issues SET display_picture_url = $1 WHERE issue_id = $2`,
          [storagePath, issue.issue_id]
        );
        issue.display_picture_url = storagePath;
      }

      // Upload attachments
      const attachments = [];
      const attachmentFiles = req.files?.['attachments'] || [];
      for (const file of attachmentFiles) {
        const fileName = generateUniqueFileName(file.originalname, 'attachment');

        const { storagePath } = await uploadToSupabase({
          bucket: 'uploads',
          folder: 'attachments',
          file: file.buffer,
          fileName,
          contentType: file.mimetype
        });

        uploadedFiles.push({ bucket: 'uploads', path: storagePath });

        const attachmentResult = await pool.query(
          `INSERT INTO post_attachments (issue_id, uploaded_by, file_path)
           VALUES ($1, $2, $3)
           RETURNING attachment_id, file_path, created_at`,
          [issue.issue_id, userId, storagePath]
        );
        attachments.push(attachmentResult.rows[0]);
      }

      // Generate signed URLs for response
      const enrichedIssue = await enrichWithSignedUrls(issue);
      const enrichedAttachments = await Promise.all(
        attachments.map(async (att) => ({
          ...att,
          file_path: await getSignedUrl('uploads', att.file_path)
        }))
      );

      res.status(201).json({
        issue_id: enrichedIssue.issue_id,
        title: enrichedIssue.title,
        description: enrichedIssue.description,
        user_id: enrichedIssue.user_id,
        group_id: enrichedIssue.group_id,
        display_picture_url: enrichedIssue.display_picture_url,
        upvote_count: enrichedIssue.upvote_count,
        comment_count: enrichedIssue.comment_count,
        posted_at: enrichedIssue.posted_at,
        attachments: enrichedAttachments
      });
    } catch (error) {
      console.error("Error creating issue:", error);

      // Cleanup uploaded files
      for (const { bucket, path } of uploadedFiles) {
        await deleteFromSupabase(bucket, path).catch(() => { });
      }

      // Cleanup database entries
      if (issue?.issue_id) {
        await pool.query(`DELETE FROM post_attachments WHERE issue_id = $1`, [issue.issue_id]).catch(() => { });
        await pool.query(`DELETE FROM issues WHERE issue_id = $1`, [issue.issue_id]).catch(() => { });
      }

      res.status(500).json({ error: "Internal server error" });
    }
  });
});

// Edit an issue
app.put("/issues/:id", authenticateToken, (req, res) => {
  uploadIssueFiles(req, res, async (err) => {
    if (err) {
      console.error("Upload error:", err);
      return res.status(400).json({ error: err.message });
    }

    const uploadedFiles = [];

    try {
      const issueId = req.params.id;
      const { title, description } = req.body;
      const userId = req.user.userId;

      if (!title || !description) {
        return res.status(400).json({ error: "Title and description are required" });
      }

      // Check if user owns the issue
      const ownerCheck = await pool.query(
        "SELECT user_id, display_picture_url FROM issues WHERE issue_id = $1",
        [issueId]
      );

      if (ownerCheck.rows.length === 0) {
        return res.status(404).json({ error: "Issue not found" });
      }

      if (ownerCheck.rows[0].user_id !== userId) {
        return res.status(403).json({ error: "You can only edit your own issues" });
      }

      let displayPictureUrl = undefined;
      const oldDisplayPicture = ownerCheck.rows[0].display_picture_url;

      // Upload new display picture if provided
      if (req.files && req.files['display_picture'] && req.files['display_picture'][0]) {
        const file = req.files['display_picture'][0];
        const fileName = generateUniqueFileName(file.originalname, 'issue');

        const { storagePath } = await uploadToSupabase({
          bucket: 'uploads',
          folder: 'issues',
          file: file.buffer,
          fileName,
          contentType: file.mimetype
        });

        uploadedFiles.push({ bucket: 'uploads', path: storagePath });
        displayPictureUrl = storagePath;

        // Delete old display picture if it exists
        if (oldDisplayPicture) {
          await deleteFromSupabase('uploads', oldDisplayPicture).catch(() => { });
        }
      }

      // Update issue
      const updateQuery = displayPictureUrl
        ? `UPDATE issues SET title = $1, description = $2, display_picture_url = $3 WHERE issue_id = $4 
           RETURNING issue_id, title, description, user_id, group_id, display_picture_url, upvote_count, comment_count, posted_at`
        : `UPDATE issues SET title = $1, description = $2 WHERE issue_id = $3 
           RETURNING issue_id, title, description, user_id, group_id, display_picture_url, upvote_count, comment_count, posted_at`;

      const params = displayPictureUrl ? [title, description, displayPictureUrl, issueId] : [title, description, issueId];
      const issueResult = await pool.query(updateQuery, params);
      const issue = issueResult.rows[0];

      // Handle new attachments
      const attachments = [];
      if (req.files && req.files['attachments']) {
        for (const file of req.files['attachments']) {
          const fileName = generateUniqueFileName(file.originalname, 'attachment');

          const { storagePath } = await uploadToSupabase({
            bucket: 'uploads',
            folder: 'attachments',
            file: file.buffer,
            fileName,
            contentType: file.mimetype
          });

          uploadedFiles.push({ bucket: 'uploads', path: storagePath });

          const attachmentResult = await pool.query(
            `INSERT INTO post_attachments (issue_id, uploaded_by, file_path)
             VALUES ($1, $2, $3)
             RETURNING attachment_id, file_path, created_at`,
            [issueId, userId, storagePath]
          );
          attachments.push(attachmentResult.rows[0]);
        }
      }

      // Generate signed URLs for response
      const enrichedIssue = await enrichWithSignedUrls(issue);
      const enrichedAttachments = await Promise.all(
        attachments.map(async (att) => ({
          ...att,
          file_path: await getSignedUrl('uploads', att.file_path)
        }))
      );

      res.json({
        issue_id: enrichedIssue.issue_id,
        title: enrichedIssue.title,
        description: enrichedIssue.description,
        user_id: enrichedIssue.user_id,
        group_id: enrichedIssue.group_id,
        display_picture_url: enrichedIssue.display_picture_url,
        upvote_count: enrichedIssue.upvote_count,
        comment_count: enrichedIssue.comment_count,
        posted_at: enrichedIssue.posted_at,
        attachments: enrichedAttachments
      });
    } catch (error) {
      console.error("Error updating issue:", error);

      // Cleanup uploaded files on error
      for (const { bucket, path } of uploadedFiles) {
        await deleteFromSupabase(bucket, path).catch(() => { });
      }

      res.status(500).json({ error: "Internal server error" });
    }
  });
});

// Get recent feed (issues without group_id, limited data for feed)
app.get("/issues/feed", authenticateToken, async (req, res) => {
  try {
    const limit = 20; // Fixed limit for feed

    // Fetch recent issues (not in groups)
    const issuesQuery = `
      SELECT 
        i.issue_id as id, i.title, i.description, i.user_id, 
        i.display_picture_url, i.upvote_count, i.comment_count, i.posted_at,
        u.username, u.full_name,
        'issue' as item_type
      FROM issues i
      JOIN users u ON i.user_id = u.user_id
      WHERE i.group_id IS NULL
      ORDER BY i.posted_at DESC 
      LIMIT $1
    `;

    // Fetch recent groups
    const groupsQuery = `
      SELECT 
        g.group_id as id, g.name as title, g.description, g.owner_id as user_id,
        g.display_picture_url, g.upvote_count, g.comment_count, g.created_at as posted_at,
        u.username, u.full_name,
        'group' as item_type
      FROM groups g
      JOIN users u ON g.owner_id = u.user_id
      ORDER BY g.created_at DESC 
      LIMIT $1
    `;

    const [issuesResult, groupsResult] = await Promise.all([
      pool.query(issuesQuery, [limit]),
      pool.query(groupsQuery, [limit])
    ]);

    // Combine and sort by recency
    const combined = [
      ...issuesResult.rows.map(row => ({
        id: row.id,
        title: row.title,
        description: row.description,
        user_id: row.user_id,
        username: row.username,
        full_name: row.full_name,
        display_picture_url: row.display_picture_url,
        upvote_count: row.upvote_count,
        comment_count: row.comment_count,
        posted_at: row.posted_at,
        item_type: 'issue'
      })),
      ...groupsResult.rows.map(row => ({
        id: row.id,
        title: row.title,
        description: row.description,
        user_id: row.user_id,
        username: row.username,
        full_name: row.full_name,
        display_picture_url: row.display_picture_url,
        upvote_count: row.upvote_count,
        comment_count: row.comment_count,
        posted_at: row.posted_at,
        item_type: 'group'
      }))
    ].sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at))
      .slice(0, limit);

    // Generate signed URLs for all items
    const enrichedItems = await Promise.all(
      combined.map(async (item) => await enrichWithSignedUrls(item))
    );

    res.json({
      items: enrichedItems,
      count: enrichedItems.length
    });
  } catch (error) {
    console.error("Error fetching feed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all issues with pagination
app.get("/issues", authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const groupId = req.query.group_id;

    let query = `
      SELECT 
        i.issue_id, i.title, i.description, i.user_id, i.group_id,
        i.display_picture_url, i.upvote_count, i.comment_count, i.posted_at,
        u.username, u.full_name,
        (SELECT COUNT(*) FROM post_attachments WHERE issue_id = i.issue_id) as attachment_count
      FROM issues i
      JOIN users u ON i.user_id = u.user_id
    `;

    const params = [];
    if (groupId) {
      query += ` WHERE i.group_id = $1`;
      params.push(groupId);
    }

    query += ` ORDER BY i.posted_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      issues: result.rows,
      limit,
      offset,
      count: result.rows.length
    });
  } catch (error) {
    console.error("Error fetching issues:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get a single issue by ID with attachments
app.get("/issues/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get issue details
    const issueResult = await pool.query(
      `SELECT 
        i.issue_id, i.title, i.description, i.user_id, i.group_id,
        i.display_picture_url, i.upvote_count, i.comment_count, i.posted_at,
        u.username, u.full_name
      FROM issues i
      JOIN users u ON i.user_id = u.user_id
      WHERE i.issue_id = $1`,
      [id]
    );

    if (issueResult.rows.length === 0) {
      return res.status(404).json({ error: "Issue not found" });
    }

    const issue = issueResult.rows[0];

    // Get attachments
    const attachmentsResult = await pool.query(
      `SELECT attachment_id, file_path, created_at, uploaded_by
       FROM post_attachments
       WHERE issue_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    // Get comments count (for verification)
    const commentsResult = await pool.query(
      `SELECT COUNT(*) as count FROM comments WHERE issue_id = $1`,
      [id]
    );

    res.json({
      issue_id: issue.issue_id,
      title: issue.title,
      description: issue.description,
      user_id: issue.user_id,
      username: issue.username,
      full_name: issue.full_name,
      group_id: issue.group_id,
      display_picture_url: issue.display_picture_url,
      upvote_count: issue.upvote_count,
      comment_count: parseInt(commentsResult.rows[0].count),
      posted_at: issue.posted_at,
      attachments: attachmentsResult.rows
    });
  } catch (error) {
    console.error("Error fetching issue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update issue upvote count (toggle upvote)
app.post("/issues/:id/upvote", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Get user's role weight
    const userRoleResult = await pool.query(
      `SELECT r.upvote_weight 
       FROM users u
       JOIN roles r ON u.role_id = r.role_id
       WHERE u.user_id = $1`,
      [userId]
    );

    const upvoteWeight = userRoleResult.rows[0]?.upvote_weight || 1;

    // Check if user already upvoted
    const existingUpvote = await pool.query(
      `SELECT upvote_id FROM issue_upvotes WHERE issue_id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (existingUpvote.rows.length > 0) {
      // Remove upvote
      await pool.query(
        `DELETE FROM issue_upvotes WHERE issue_id = $1 AND user_id = $2`,
        [id, userId]
      );

      // Decrement count by role weight
      const result = await pool.query(
        `UPDATE issues SET upvote_count = GREATEST(upvote_count - $1, 0)
         WHERE issue_id = $2 
         RETURNING upvote_count`,
        [upvoteWeight, id]
      );

      res.json({ upvoted: false, upvote_count: result.rows[0].upvote_count });
    } else {
      // Add upvote
      await pool.query(
        `INSERT INTO issue_upvotes (issue_id, user_id) VALUES ($1, $2)`,
        [id, userId]
      );

      // Increment count by role weight
      const result = await pool.query(
        `UPDATE issues SET upvote_count = upvote_count + $1
         WHERE issue_id = $2 
         RETURNING upvote_count`,
        [upvoteWeight, id]
      );

      res.json({ upvoted: true, upvote_count: result.rows[0].upvote_count });
    }
  } catch (error) {
    console.error("Error toggling upvote:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get users who upvoted an issue
app.get("/issues/:id/upvotes", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT u.user_id, u.username, u.full_name, u.email, iu.made_at
       FROM issue_upvotes iu
       JOIN users u ON iu.user_id = u.user_id
       WHERE iu.issue_id = $1
       ORDER BY iu.made_at DESC`,
      [id]
    );

    res.json({
      upvotes: result.rows.map(row => ({
        user_id: row.user_id,
        username: row.username,
        full_name: row.full_name,
        email: row.email,
        upvoted_at: row.made_at
      }))
    });
  } catch (error) {
    console.error("Error fetching upvotes:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ COMMENT ROUTES ============

// Get comments for an issue
app.get("/issues/:id/comments", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT c.comment_id, c.issue_id, c.user_id, c.content, c.posted_at,
              u.username, u.full_name
       FROM comments c
       JOIN users u ON c.user_id = u.user_id
       WHERE c.issue_id = $1
       ORDER BY c.posted_at ASC`,
      [id]
    );

    res.json({
      comments: result.rows.map(row => ({
        comment_id: row.comment_id,
        issue_id: row.issue_id,
        user_id: row.user_id,
        username: row.username,
        full_name: row.full_name,
        content: row.content,
        posted_at: row.posted_at
      }))
    });
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Add a comment to an issue
app.post("/issues/:id/comments", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user.userId;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: "Comment content is required" });
    }

    // Insert comment
    const result = await pool.query(
      `INSERT INTO comments (issue_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING comment_id, issue_id, user_id, content, posted_at`,
      [id, userId, content.trim()]
    );

    // Get user info
    const userResult = await pool.query(
      `SELECT username, full_name FROM users WHERE user_id = $1`,
      [userId]
    );

    // Update comment count on issue
    await pool.query(
      `UPDATE issues SET comment_count = comment_count + 1 WHERE issue_id = $1`,
      [id]
    );

    const comment = result.rows[0];
    const user = userResult.rows[0];

    res.status(201).json({
      comment_id: comment.comment_id,
      issue_id: comment.issue_id,
      user_id: comment.user_id,
      username: user.username,
      full_name: user.full_name,
      content: comment.content,
      posted_at: comment.posted_at
    });
  } catch (error) {
    console.error("Error adding comment:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ GROUP ROUTES ============

// Create a new group with optional display picture
app.post("/groups", authenticateToken, (req, res) => {
  uploadIssueFiles(req, res, async (err) => {
    if (err) {
      console.error("Upload error:", err);
      return res.status(400).json({ error: err.message });
    }

    let uploadedFile = null;

    try {
      const { name, description } = req.body;
      const userId = req.user.userId;

      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }

      let displayPictureUrl = null;
      if (req.files && req.files['display_picture'] && req.files['display_picture'][0]) {
        const file = req.files['display_picture'][0];
        const fileName = generateUniqueFileName(file.originalname, 'group');

        const { storagePath } = await uploadToSupabase({
          bucket: 'uploads',
          folder: 'issues',
          file: file.buffer,
          fileName,
          contentType: file.mimetype
        });

        uploadedFile = { bucket: 'uploads', path: storagePath };
        displayPictureUrl = storagePath;
      }

      // Insert group
      const result = await pool.query(
        `INSERT INTO groups (name, description, owner_id, display_picture_url, upvote_count, comment_count)
         VALUES ($1, $2, $3, $4, 0, 0)
         RETURNING group_id, name, description, owner_id, display_picture_url, upvote_count, comment_count, created_at`,
        [name, description || null, userId, displayPictureUrl]
      );

      const group = result.rows[0];
      const enrichedGroup = await enrichWithSignedUrls(group);

      res.status(201).json({
        group_id: enrichedGroup.group_id,
        name: enrichedGroup.name,
        description: enrichedGroup.description,
        owner_id: enrichedGroup.owner_id,
        display_picture_url: enrichedGroup.display_picture_url,
        upvote_count: enrichedGroup.upvote_count,
        comment_count: enrichedGroup.comment_count,
        created_at: enrichedGroup.created_at
      });
    } catch (error) {
      console.error("Error creating group:", error);

      // Cleanup uploaded file on error
      if (uploadedFile) {
        await deleteFromSupabase(uploadedFile.bucket, uploadedFile.path).catch(() => { });
      }

      res.status(500).json({ error: "Internal server error" });
    }
  });
});

// Edit a group
app.put("/groups/:id", authenticateToken, (req, res) => {
  uploadIssueFiles(req, res, async (err) => {
    if (err) {
      console.error("Upload error:", err);
      return res.status(400).json({ error: err.message });
    }

    let uploadedFile = null;

    try {
      const groupId = req.params.id;
      const { name, description } = req.body;
      const userId = req.user.userId;

      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }

      // Check if user owns the group
      const ownerCheck = await pool.query(
        "SELECT owner_id, display_picture_url FROM groups WHERE group_id = $1",
        [groupId]
      );

      if (ownerCheck.rows.length === 0) {
        return res.status(404).json({ error: "Group not found" });
      }

      if (ownerCheck.rows[0].owner_id !== userId) {
        return res.status(403).json({ error: "You can only edit your own groups" });
      }

      let displayPictureUrl = undefined;
      const oldDisplayPicture = ownerCheck.rows[0].display_picture_url;

      // Upload new display picture if provided
      if (req.files && req.files['display_picture'] && req.files['display_picture'][0]) {
        const file = req.files['display_picture'][0];
        const fileName = generateUniqueFileName(file.originalname, 'group');

        const { storagePath } = await uploadToSupabase({
          bucket: 'uploads',
          folder: 'issues',
          file: file.buffer,
          fileName,
          contentType: file.mimetype
        });

        uploadedFile = { bucket: 'uploads', path: storagePath };
        displayPictureUrl = storagePath;

        // Delete old display picture if it exists
        if (oldDisplayPicture) {
          await deleteFromSupabase('uploads', oldDisplayPicture).catch(() => { });
        }
      }

      // Update group
      const updateQuery = displayPictureUrl
        ? `UPDATE groups SET name = $1, description = $2, display_picture_url = $3 WHERE group_id = $4 
           RETURNING group_id, name, description, owner_id, display_picture_url, upvote_count, comment_count, created_at`
        : `UPDATE groups SET name = $1, description = $2 WHERE group_id = $3 
           RETURNING group_id, name, description, owner_id, display_picture_url, upvote_count, comment_count, created_at`;

      const params = displayPictureUrl ? [name, description, displayPictureUrl, groupId] : [name, description, groupId];
      const result = await pool.query(updateQuery, params);
      const group = result.rows[0];

      const enrichedGroup = await enrichWithSignedUrls(group);

      res.json({
        group_id: enrichedGroup.group_id,
        name: enrichedGroup.name,
        description: enrichedGroup.description,
        owner_id: enrichedGroup.owner_id,
        display_picture_url: enrichedGroup.display_picture_url,
        upvote_count: enrichedGroup.upvote_count,
        comment_count: enrichedGroup.comment_count,
        created_at: enrichedGroup.created_at
      });
    } catch (error) {
      console.error("Error updating group:", error);

      // Cleanup uploaded file on error
      if (uploadedFile) {
        await deleteFromSupabase(uploadedFile.bucket, uploadedFile.path).catch(() => { });
      }

      res.status(500).json({ error: "Internal server error" });
    }
  });
});

// Get all groups with pagination
app.get("/groups", authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      `SELECT 
        g.group_id, g.name, g.description, g.owner_id, g.display_picture_url,
        g.upvote_count, g.comment_count, g.created_at,
        u.username, u.full_name,
        (SELECT COUNT(*) FROM issues WHERE group_id = g.group_id) as issue_count
       FROM groups g
       JOIN users u ON g.owner_id = u.user_id
       ORDER BY g.created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({
      groups: result.rows,
      limit,
      offset,
      count: result.rows.length
    });
  } catch (error) {
    console.error("Error fetching groups:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get a single group by ID with issues
app.get("/groups/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get group details
    const groupResult = await pool.query(
      `SELECT 
        g.group_id, g.name, g.description, g.owner_id, g.display_picture_url,
        g.upvote_count, g.comment_count, g.created_at,
        u.username, u.full_name
       FROM groups g
       JOIN users u ON g.owner_id = u.user_id
       WHERE g.group_id = $1`,
      [id]
    );

    if (groupResult.rows.length === 0) {
      return res.status(404).json({ error: "Group not found" });
    }

    const group = groupResult.rows[0];

    // Get issues in this group
    const issuesResult = await pool.query(
      `SELECT issue_id, title, description, user_id, display_picture_url, upvote_count, comment_count, posted_at
       FROM issues
       WHERE group_id = $1
       ORDER BY posted_at DESC`,
      [id]
    );

    res.json({
      group_id: group.group_id,
      name: group.name,
      description: group.description,
      owner_id: group.owner_id,
      username: group.username,
      full_name: group.full_name,
      display_picture_url: group.display_picture_url,
      upvote_count: group.upvote_count,
      comment_count: group.comment_count,
      created_at: group.created_at,
      issues: issuesResult.rows
    });
  } catch (error) {
    console.error("Error fetching group:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Toggle upvote for a group
app.post("/groups/:id/upvote", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check if user already upvoted
    const existingUpvote = await pool.query(
      `SELECT group_upvote_id FROM group_upvotes WHERE group_id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (existingUpvote.rows.length > 0) {
      // Remove upvote
      await pool.query(
        `DELETE FROM group_upvotes WHERE group_id = $1 AND user_id = $2`,
        [id, userId]
      );

      // Decrement count
      const result = await pool.query(
        `UPDATE groups SET upvote_count = upvote_count - 1 
         WHERE group_id = $1 
         RETURNING upvote_count`,
        [id]
      );

      res.json({ upvoted: false, upvote_count: result.rows[0].upvote_count });
    } else {
      // Add upvote
      await pool.query(
        `INSERT INTO group_upvotes (group_id, user_id) VALUES ($1, $2)`,
        [id, userId]
      );

      // Increment count
      const result = await pool.query(
        `UPDATE groups SET upvote_count = upvote_count + 1 
         WHERE group_id = $1 
         RETURNING upvote_count`,
        [id]
      );

      res.json({ upvoted: true, upvote_count: result.rows[0].upvote_count });
    }
  } catch (error) {
    console.error("Error toggling group upvote:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get users who upvoted a group
app.get("/groups/:id/upvotes", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT u.user_id, u.username, u.full_name, u.email, gu.made_at
       FROM group_upvotes gu
       JOIN users u ON gu.user_id = u.user_id
       WHERE gu.group_id = $1
       ORDER BY gu.made_at DESC`,
      [id]
    );

    res.json({
      upvotes: result.rows.map(row => ({
        user_id: row.user_id,
        username: row.username,
        full_name: row.full_name,
        email: row.email,
        upvoted_at: row.made_at
      }))
    });
  } catch (error) {
    console.error("Error fetching group upvotes:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get comments for a group
app.get("/groups/:id/comments", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT c.comment_id, c.group_id, c.user_id, c.content, c.posted_at,
              u.username, u.full_name
       FROM group_comments c
       JOIN users u ON c.user_id = u.user_id
       WHERE c.group_id = $1
       ORDER BY c.posted_at ASC`,
      [id]
    );

    res.json({
      comments: result.rows.map(row => ({
        comment_id: row.comment_id,
        group_id: row.group_id,
        user_id: row.user_id,
        username: row.username,
        full_name: row.full_name,
        content: row.content,
        posted_at: row.posted_at
      }))
    });
  } catch (error) {
    console.error("Error fetching group comments:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Add a comment to a group
app.post("/groups/:id/comments", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user.userId;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: "Comment content is required" });
    }

    // Insert comment
    const result = await pool.query(
      `INSERT INTO group_comments (group_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING comment_id, group_id, user_id, content, posted_at`,
      [id, userId, content.trim()]
    );

    // Get user info
    const userResult = await pool.query(
      `SELECT username, full_name FROM users WHERE user_id = $1`,
      [userId]
    );

    // Update comment count on group
    await pool.query(
      `UPDATE groups SET comment_count = comment_count + 1 WHERE group_id = $1`,
      [id]
    );

    const comment = result.rows[0];
    const user = userResult.rows[0];

    res.status(201).json({
      comment_id: comment.comment_id,
      group_id: comment.group_id,
      user_id: comment.user_id,
      username: user.username,
      full_name: user.full_name,
      content: comment.content,
      posted_at: comment.posted_at
    });
  } catch (error) {
    console.error("Error adding group comment:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ USER ROUTES ============

// Get user by ID
app.get("/users/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT u.user_id, u.username, u.email, u.full_name, u.role_id, u.created_at,
              r.title as role_title, r.description as role_description
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.role_id
       WHERE u.user_id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];
    res.json({
      user_id: user.user_id,
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      role_id: user.role_id,
      role_title: user.role_title,
      role_description: user.role_description,
      created_at: user.created_at
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get multiple users by IDs (batch fetch)
app.post("/users/batch", authenticateToken, async (req, res) => {
  try {
    const { user_ids } = req.body;

    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ error: "user_ids array is required" });
    }

    // Limit batch size to prevent abuse
    if (user_ids.length > 100) {
      return res.status(400).json({ error: "Maximum 100 user IDs per request" });
    }

    const result = await pool.query(
      `SELECT u.user_id, u.username, u.email, u.full_name, u.role_id, u.created_at,
              r.title as role_title, r.description as role_description
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.role_id
       WHERE u.user_id = ANY($1)`,
      [user_ids]
    );

    const users = result.rows.map(user => ({
      user_id: user.user_id,
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      role_id: user.role_id,
      role_title: user.role_title,
      role_description: user.role_description,
      created_at: user.created_at
    }));

    res.json({ users });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

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

// ============ GROUP JOIN REQUEST ROUTES ============

// Create a group join request
app.post("/group-join-requests", authenticateToken, async (req, res) => {
  try {
    const { issue_id, group_id, requested_by_group } = req.body;
    const userId = req.user.userId;

    if (!issue_id || !group_id || typeof requested_by_group !== 'boolean') {
      return res.status(400).json({
        error: "issue_id, group_id, and requested_by_group are required"
      });
    }

    // Fetch issue and group info for authorization and auto-accept check
    const issueCheck = await pool.query(
      "SELECT user_id FROM issues WHERE issue_id = $1",
      [issue_id]
    );
    if (issueCheck.rows.length === 0) {
      return res.status(404).json({ error: "Issue not found" });
    }

    const groupCheck = await pool.query(
      "SELECT owner_id FROM groups WHERE group_id = $1",
      [group_id]
    );
    if (groupCheck.rows.length === 0) {
      return res.status(404).json({ error: "Group not found" });
    }

    const issueOwnerId = issueCheck.rows[0].user_id;
    const groupOwnerId = groupCheck.rows[0].owner_id;

    // Check authorization: either issue owner or group owner
    if (requested_by_group) {
      // Group owner is requesting to include an issue
      if (groupOwnerId !== userId) {
        return res.status(403).json({ error: "Only group owner can make this request" });
      }
    } else {
      // Issue owner is requesting to join a group
      if (issueOwnerId !== userId) {
        return res.status(403).json({ error: "Only issue owner can make this request" });
      }
    }

    // Check if issue is already in the group
    const existingLink = await pool.query(
      "SELECT 1 FROM issues WHERE issue_id = $1 AND group_id = $2",
      [issue_id, group_id]
    );
    if (existingLink.rows.length > 0) {
      return res.status(400).json({ error: "Issue is already in this group" });
    }

    // Check if there's already a pending request
    const existingRequest = await pool.query(
      `SELECT req_id FROM group_join_request 
       WHERE issue_id = $1 AND group_id = $2 AND status = 'pending'`,
      [issue_id, group_id]
    );
    if (existingRequest.rows.length > 0) {
      return res.status(400).json({ error: "A pending request already exists" });
    }

    // AUTO-ACCEPT: If group owner is adding their own issue, auto-approve
    const isOwnerAddingOwnIssue = (groupOwnerId === issueOwnerId && groupOwnerId === userId);

    if (isOwnerAddingOwnIssue) {
      // Directly add issue to group without creating a request
      await pool.query(
        "UPDATE issues SET group_id = $1 WHERE issue_id = $2",
        [group_id, issue_id]
      );

      // Create an approved request record for history
      const result = await pool.query(
        `INSERT INTO group_join_request (issue_id, group_id, requested_by_group, status, requested_at, handled_at)
         VALUES ($1, $2, $3, 'approved', NOW(), NOW())
         RETURNING req_id, issue_id, group_id, requested_by_group, status, requested_at, handled_at`,
        [issue_id, group_id, requested_by_group]
      );

      return res.status(201).json({
        request: result.rows[0],
        auto_accepted: true,
        message: "Issue automatically added to your group"
      });
    }

    // Create pending request (normal flow for other cases)
    const result = await pool.query(
      `INSERT INTO group_join_request (issue_id, group_id, requested_by_group, status, requested_at)
       VALUES ($1, $2, $3, 'pending', NOW())
       RETURNING req_id, issue_id, group_id, requested_by_group, status, requested_at, handled_at`,
      [issue_id, group_id, requested_by_group]
    );

    res.status(201).json({
      request: result.rows[0]
    });
  } catch (error) {
    console.error("Error creating group join request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get group join requests
app.get("/group-join-requests", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const direction = req.query.direction; // 'incoming' or 'outgoing'

    let query;
    if (direction === 'incoming') {
      // Requests where the current user can act
      query = `
        SELECT 
          gjr.req_id, gjr.issue_id, gjr.group_id, gjr.requested_by_group, 
          gjr.status, gjr.requested_at, gjr.handled_at,
          i.title as issue_title, i.description as issue_description,
          i.user_id as issue_owner_id, iu.username as issue_owner_username,
          g.name as group_name, g.description as group_description,
          g.owner_id as group_owner_id, gu.username as group_owner_username
        FROM group_join_request gjr
        JOIN issues i ON gjr.issue_id = i.issue_id
        JOIN users iu ON i.user_id = iu.user_id
        JOIN groups g ON gjr.group_id = g.group_id
        JOIN users gu ON g.owner_id = gu.user_id
        WHERE 
          (gjr.requested_by_group = true AND i.user_id = $1) OR
          (gjr.requested_by_group = false AND g.owner_id = $1)
        ORDER BY gjr.requested_at DESC
      `;
    } else if (direction === 'outgoing') {
      // Requests initiated by the current user
      query = `
        SELECT 
          gjr.req_id, gjr.issue_id, gjr.group_id, gjr.requested_by_group, 
          gjr.status, gjr.requested_at, gjr.handled_at,
          i.title as issue_title, i.description as issue_description,
          i.user_id as issue_owner_id, iu.username as issue_owner_username,
          g.name as group_name, g.description as group_description,
          g.owner_id as group_owner_id, gu.username as group_owner_username
        FROM group_join_request gjr
        JOIN issues i ON gjr.issue_id = i.issue_id
        JOIN users iu ON i.user_id = iu.user_id
        JOIN groups g ON gjr.group_id = g.group_id
        JOIN users gu ON g.owner_id = gu.user_id
        WHERE 
          (gjr.requested_by_group = true AND g.owner_id = $1) OR
          (gjr.requested_by_group = false AND i.user_id = $1)
        ORDER BY gjr.requested_at DESC
      `;
    } else {
      // All requests involving the user
      query = `
        SELECT 
          gjr.req_id, gjr.issue_id, gjr.group_id, gjr.requested_by_group, 
          gjr.status, gjr.requested_at, gjr.handled_at,
          i.title as issue_title, i.description as issue_description,
          i.user_id as issue_owner_id, iu.username as issue_owner_username,
          g.name as group_name, g.description as group_description,
          g.owner_id as group_owner_id, gu.username as group_owner_username
        FROM group_join_request gjr
        JOIN issues i ON gjr.issue_id = i.issue_id
        JOIN users iu ON i.user_id = iu.user_id
        JOIN groups g ON gjr.group_id = g.group_id
        JOIN users gu ON g.owner_id = gu.user_id
        WHERE i.user_id = $1 OR g.owner_id = $1
        ORDER BY gjr.requested_at DESC
      `;
    }

    const result = await pool.query(query, [userId]);

    res.json({
      requests: result.rows
    });
  } catch (error) {
    console.error("Error fetching group join requests:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Accept or decline a group join request
app.put("/group-join-requests/:id", authenticateToken, async (req, res) => {
  try {
    const requestId = req.params.id;
    const { status } = req.body;
    const userId = req.user.userId;

    if (!status || !['accepted', 'declined'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'accepted' or 'declined'" });
    }

    // Get the request details
    const requestQuery = await pool.query(
      `SELECT gjr.*, i.user_id as issue_owner_id, g.owner_id as group_owner_id
       FROM group_join_request gjr
       JOIN issues i ON gjr.issue_id = i.issue_id
       JOIN groups g ON gjr.group_id = g.group_id
       WHERE gjr.req_id = $1`,
      [requestId]
    );

    if (requestQuery.rows.length === 0) {
      return res.status(404).json({ error: "Request not found" });
    }

    const request = requestQuery.rows[0];

    // Check if request is still pending
    if (request.status !== 'pending') {
      return res.status(400).json({ error: "Request is not pending" });
    }

    // Check authorization
    let canAct = false;
    if (request.requested_by_group) {
      // Group requested to include issue; issue owner can act
      canAct = request.issue_owner_id === userId;
    } else {
      // Issue requested to join group; group owner can act
      canAct = request.group_owner_id === userId;
    }

    if (!canAct) {
      return res.status(403).json({ error: "Not authorized to act on this request" });
    }

    // Update the request
    await pool.query(
      `UPDATE group_join_request 
       SET status = $1, handled_at = NOW()
       WHERE req_id = $2`,
      [status, requestId]
    );

    // If accepted, add issue to group
    if (status === 'accepted') {
      await pool.query(
        `UPDATE issues SET group_id = $1 WHERE issue_id = $2`,
        [request.group_id, request.issue_id]
      );
    }

    res.json({
      message: `Request ${status}`,
      request_id: requestId
    });
  } catch (error) {
    console.error("Error processing group join request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Cancel a group join request
app.delete("/group-join-requests/:id", authenticateToken, async (req, res) => {
  try {
    const requestId = req.params.id;
    const userId = req.user.userId;

    // Get the request details
    const requestQuery = await pool.query(
      `SELECT gjr.*, i.user_id as issue_owner_id, g.owner_id as group_owner_id
       FROM group_join_request gjr
       JOIN issues i ON gjr.issue_id = i.issue_id
       JOIN groups g ON gjr.group_id = g.group_id
       WHERE gjr.req_id = $1`,
      [requestId]
    );

    if (requestQuery.rows.length === 0) {
      return res.status(404).json({ error: "Request not found" });
    }

    const request = requestQuery.rows[0];

    // Check if request is still pending
    if (request.status !== 'pending') {
      return res.status(400).json({ error: "Request is not pending" });
    }

    // Check authorization - requester can cancel
    let canCancel = false;
    if (request.requested_by_group) {
      // Group owner can cancel their outgoing request
      canCancel = request.group_owner_id === userId;
    } else {
      // Issue owner can cancel their outgoing request
      canCancel = request.issue_owner_id === userId;
    }

    if (!canCancel) {
      return res.status(403).json({ error: "Not authorized to cancel this request" });
    }

    // Update the request to cancelled
    await pool.query(
      `UPDATE group_join_request 
       SET status = 'cancelled', handled_at = NOW()
       WHERE req_id = $1`,
      [requestId]
    );

    res.json({
      message: "Request cancelled",
      request_id: requestId
    });
  } catch (error) {
    console.error("Error cancelling group join request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ SEARCH ROUTE ============

// Search across users, issues, and groups
app.get("/search", authenticateToken, async (req, res) => {
  try {
    const query = req.query.q || '';
    const type = req.query.type || 'all'; // all, users, issues, groups
    const limit = parseInt(req.query.limit) || 50;

    if (!query.trim()) {
      return res.json({
        users: [],
        issues: [],
        groups: [],
        total: 0
      });
    }

    const searchTerm = `%${query}%`;
    const results = {
      users: [],
      issues: [],
      groups: [],
      total: 0
    };

    // Search users
    if (type === 'all' || type === 'users') {
      const usersQuery = `
        SELECT user_id, username, full_name, email
        FROM users
        WHERE username ILIKE $1 OR full_name ILIKE $1 OR email ILIKE $1
        ORDER BY 
          CASE 
            WHEN username ILIKE $2 THEN 1
            WHEN full_name ILIKE $2 THEN 2
            ELSE 3
          END,
          created_at DESC
        LIMIT $3
      `;
      const usersResult = await pool.query(usersQuery, [searchTerm, query, limit]);
      results.users = usersResult.rows;
    }

    // Search issues
    if (type === 'all' || type === 'issues') {
      const issuesQuery = `
        SELECT 
          i.issue_id, i.title, i.description, i.user_id,
          i.display_picture_url, i.upvote_count, i.comment_count, i.posted_at,
          u.username, u.full_name
        FROM issues i
        JOIN users u ON i.user_id = u.user_id
        WHERE i.title ILIKE $1 OR i.description ILIKE $1
        ORDER BY 
          CASE 
            WHEN i.title ILIKE $2 THEN 1
            WHEN i.description ILIKE $2 THEN 2
            ELSE 3
          END,
          i.posted_at DESC
        LIMIT $3
      `;
      const issuesResult = await pool.query(issuesQuery, [searchTerm, query, limit]);
      results.issues = issuesResult.rows;
    }

    // Search groups
    if (type === 'all' || type === 'groups') {
      const groupsQuery = `
        SELECT 
          g.group_id, g.name as title, g.description, g.owner_id as user_id,
          g.display_picture_url, g.upvote_count, g.comment_count, g.created_at as posted_at,
          u.username, u.full_name,
          (SELECT COUNT(*) FROM issues WHERE group_id = g.group_id) as issue_count
        FROM groups g
        JOIN users u ON g.owner_id = u.user_id
        WHERE g.name ILIKE $1 OR g.description ILIKE $1
        ORDER BY 
          CASE 
            WHEN g.name ILIKE $2 THEN 1
            WHEN g.description ILIKE $2 THEN 2
            ELSE 3
          END,
          g.created_at DESC
        LIMIT $3
      `;
      const groupsResult = await pool.query(groupsQuery, [searchTerm, query, limit]);
      results.groups = groupsResult.rows;
    }

    results.total = results.users.length + results.issues.length + results.groups.length;

    res.json(results);
  } catch (error) {
    console.error("Error searching:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ ROLES ROUTES ============

// Get all available roles
app.get("/roles", async (req, res) => {
  try {
    console.log('[GET /roles] Fetching roles from database');
    const result = await pool.query(
      `SELECT role_id, title, description, upvote_weight 
       FROM roles 
       ORDER BY upvote_weight ASC, title ASC`
    );

    console.log('[GET /roles] Found', result.rows.length, 'roles');
    const response = { roles: result.rows };
    console.log('[GET /roles] Sending response:', JSON.stringify(response));
    res.json(response);
  } catch (error) {
    console.error("Error fetching roles:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ ROLE CHANGE REQUEST ROUTES ============

// Submit a role change request
app.post("/role-change-requests", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { requested_role_id } = req.body;

    if (!requested_role_id) {
      return res.status(400).json({ error: "requested_role_id is required" });
    }

    // Check if user already has a pending request
    const existingRequest = await pool.query(
      `SELECT req_id FROM role_change_request 
       WHERE user_id = $1 AND status = 'pending'`,
      [userId]
    );

    if (existingRequest.rows.length > 0) {
      return res.status(400).json({
        error: "You already have a pending role change request"
      });
    }

    // Check if requested role exists
    const roleCheck = await pool.query(
      `SELECT role_id FROM roles WHERE role_id = $1`,
      [requested_role_id]
    );

    if (roleCheck.rows.length === 0) {
      return res.status(404).json({ error: "Requested role not found" });
    }

    // Create the request
    const result = await pool.query(
      `INSERT INTO role_change_request (user_id, requested_role_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING req_id, user_id, requested_role_id, status, submitted_at`,
      [userId, requested_role_id]
    );

    res.status(201).json({
      request: result.rows[0]
    });
  } catch (error) {
    console.error("Error creating role change request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get current user's role change requests
app.get("/role-change-requests/my", authenticateToken, async (req, res) => {
  try {
    console.log('[GET /role-change-requests/my] User ID:', req.user.userId);
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT rcr.req_id, rcr.submitted_at, rcr.reviewed_at, rcr.status,
              r_current.title as current_role,
              r_requested.title as requested_role,
              rcr.requested_role_id
       FROM role_change_request rcr
       JOIN users u ON rcr.user_id = u.user_id
       JOIN roles r_current ON u.role_id = r_current.role_id
       JOIN roles r_requested ON rcr.requested_role_id = r_requested.role_id
       WHERE rcr.user_id = $1
       ORDER BY rcr.submitted_at DESC
       LIMIT 10`,
      [userId]
    );

    res.json({
      requests: result.rows
    });
  } catch (error) {
    console.error("Error fetching user role requests:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ ADMIN AUTH ROUTES ============

// Admin registration
app.post("/admin/register", async (req, res) => {
  const { email, password, first_name, last_name } = req.body;

  if (!email || !password || !first_name || !last_name) {
    return res.status(400).json({
      error: "Email, password, first_name, and last_name are required"
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
    // Check if email already exists
    const existingAdmin = await pool.query(
      'SELECT admin_id FROM admin WHERE email = $1',
      [email]
    );

    if (existingAdmin.rows.length > 0) {
      return res.status(400).json({
        error: "Email already exists"
      });
    }

    // Hash the password
    const password_hash = await hashPassword(password);

    // Insert new admin
    const result = await pool.query(
      `INSERT INTO admin (email, password_hash, first_name, last_name) 
       VALUES ($1, $2, $3, $4)
       RETURNING admin_id, email, first_name, last_name, created_at`,
      [email, password_hash, first_name, last_name]
    );

    const admin = result.rows[0];

    // Generate JWT token
    const token = generateToken({
      adminId: admin.admin_id,
      email: admin.email,
      type: 'admin'
    });

    res.status(201).json({
      token,
      admin: {
        admin_id: admin.admin_id,
        email: admin.email,
        first_name: admin.first_name,
        last_name: admin.last_name,
        created_at: admin.created_at
      }
    });
  } catch (err) {
    console.error("Error registering admin:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin login
app.post("/admin/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: "Email and password are required"
    });
  }

  try {
    // Get admin by email
    const result = await pool.query(
      `SELECT admin_id, email, first_name, last_name, password_hash, created_at 
       FROM admin 
       WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const admin = result.rows[0];

    // Verify password
    const isValidPassword = await comparePassword(password, admin.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Generate JWT token
    const token = generateToken({
      adminId: admin.admin_id,
      email: admin.email,
      type: 'admin'
    });

    res.json({
      token,
      admin: {
        admin_id: admin.admin_id,
        email: admin.email,
        first_name: admin.first_name,
        last_name: admin.last_name,
        created_at: admin.created_at
      }
    });
  } catch (err) {
    console.error("Error logging in admin:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get current admin info
app.get("/admin/me", authenticateToken, async (req, res) => {
  try {
    // Check if the authenticated user is an admin
    if (req.user.type !== 'admin') {
      return res.status(403).json({ error: "Access denied. Admin only." });
    }

    const adminId = req.user.adminId;

    const result = await pool.query(
      `SELECT admin_id, email, first_name, last_name, created_at 
       FROM admin 
       WHERE admin_id = $1`,
      [adminId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Admin not found" });
    }

    res.json({
      admin: result.rows[0]
    });
  } catch (err) {
    console.error("Error fetching admin info:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ============ ADMIN MANAGEMENT ENDPOINTS ============

// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
  console.log('requireAdmin middleware - req.user:', req.user);
  if (!req.user || req.user.type !== 'admin') {
    return res.status(403).json({ error: "Access denied. Admin only.", user: req.user });
  }
  next();
};

// Get all users with pagination
app.get("/admin/users", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    const searchCondition = search ?
      `WHERE username ILIKE $3 OR full_name ILIKE $3 OR email ILIKE $3` : '';

    const params = search ? [limit, offset, `%${search}%`] : [limit, offset];

    const countQuery = `SELECT COUNT(*) FROM users ${searchCondition}`;
    const countResult = await pool.query(
      countQuery,
      search ? [`%${search}%`] : []
    );
    const total = parseInt(countResult.rows[0].count);

    const usersQuery = `
      SELECT u.user_id, u.email, u.username, u.full_name, u.created_at,
             r.title as role_title, r.role_id
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.role_id
      ${searchCondition}
      ORDER BY u.created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const result = await pool.query(usersQuery, params);

    res.json({
      users: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all issues with pagination
app.get("/admin/issues", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    const searchCondition = search ?
      `WHERE i.title ILIKE $3 OR i.description ILIKE $3` : '';

    const params = search ? [limit, offset, `%${search}%`] : [limit, offset];

    const countQuery = `SELECT COUNT(*) FROM issues i ${searchCondition}`;
    const countResult = await pool.query(
      countQuery,
      search ? [`%${search}%`] : []
    );
    const total = parseInt(countResult.rows[0].count);

    const issuesQuery = `
      SELECT i.issue_id, i.title, i.description, i.posted_at,
             i.upvote_count, i.comment_count, i.display_picture_url,
             u.username, u.full_name, u.user_id,
             g.name as group_name, g.group_id
      FROM issues i
      JOIN users u ON i.user_id = u.user_id
      LEFT JOIN groups g ON i.group_id = g.group_id
      ${searchCondition}
      ORDER BY i.posted_at DESC
      LIMIT $1 OFFSET $2
    `;

    const result = await pool.query(issuesQuery, params);

    res.json({
      issues: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Error fetching issues:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete an issue
app.delete("/admin/issues/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const issueId = req.params.id;

    await pool.query("DELETE FROM issues WHERE issue_id = $1", [issueId]);

    res.json({ message: "Issue deleted successfully" });
  } catch (error) {
    console.error("Error deleting issue:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all groups with pagination
app.get("/admin/groups", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';

    const searchCondition = search ?
      `WHERE g.name ILIKE $3 OR g.description ILIKE $3` : '';

    const params = search ? [limit, offset, `%${search}%`] : [limit, offset];

    const countQuery = `SELECT COUNT(*) FROM groups g ${searchCondition}`;
    const countResult = await pool.query(
      countQuery,
      search ? [`%${search}%`] : []
    );
    const total = parseInt(countResult.rows[0].count);

    const groupsQuery = `
      SELECT g.group_id, g.name, g.description, g.created_at,
             g.upvote_count, g.comment_count, g.display_picture_url,
             u.username, u.full_name, u.user_id as owner_id,
             (SELECT COUNT(*) FROM issues WHERE group_id = g.group_id) as issue_count
      FROM groups g
      JOIN users u ON g.owner_id = u.user_id
      ${searchCondition}
      ORDER BY g.created_at DESC
      LIMIT $1 OFFSET $2
    `;

    const result = await pool.query(groupsQuery, params);

    res.json({
      groups: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Error fetching groups:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete a group
app.delete("/admin/groups/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const groupId = req.params.id;

    await pool.query("DELETE FROM groups WHERE group_id = $1", [groupId]);

    res.json({ message: "Group deleted successfully" });
  } catch (error) {
    console.error("Error deleting group:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all role change requests
app.get("/admin/role-requests", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const status = req.query.status || 'pending';

    const requestsQuery = `
      SELECT rcr.req_id, rcr.submitted_at, rcr.reviewed_at, rcr.status,
             u.user_id, u.username, u.full_name, u.email,
             r_current.title as current_role,
             r_requested.title as requested_role,
             r_requested.role_id as requested_role_id
      FROM role_change_request rcr
      JOIN users u ON rcr.user_id = u.user_id
      JOIN roles r_current ON u.role_id = r_current.role_id
      JOIN roles r_requested ON rcr.requested_role_id = r_requested.role_id
      WHERE rcr.status = $1
      ORDER BY rcr.submitted_at DESC
    `;

    console.log('Executing query:', requestsQuery);
    console.log('With params:', [status]);
    const result = await pool.query(requestsQuery, [status]);

    res.json({
      requests: result.rows
    });
  } catch (error) {
    console.error("Error fetching role requests:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Approve/reject role change request
app.put("/admin/role-requests/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const requestId = req.params.id;
    const { status } = req.body; // 'approved' or 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'approved' or 'rejected'" });
    }

    // Use the stored procedure
    await pool.query(
      "SELECT process_role_change_request($1, $2)",
      [requestId, status]
    );

    res.json({ message: `Request ${status}` });
  } catch (error) {
    console.error("Error processing role request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get dashboard statistics
app.get("/admin/stats", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM issues) as total_issues,
        (SELECT COUNT(*) FROM groups) as total_groups,
        (SELECT COUNT(*) FROM role_change_request WHERE status = 'pending') as pending_role_requests,
        (SELECT COUNT(*) FROM group_join_request WHERE status = 'pending') as pending_join_requests,
        (SELECT COUNT(*) FROM comments) as total_comments
    `);

    const recentActivity = await pool.query(`
      (SELECT 'issue' as type, issue_id as id, title as name, posted_at as created_at 
       FROM issues ORDER BY posted_at DESC LIMIT 5)
      UNION ALL
      (SELECT 'group' as type, group_id as id, name, created_at 
       FROM groups ORDER BY created_at DESC LIMIT 5)
      ORDER BY created_at DESC
      LIMIT 10
    `);

    res.json({
      stats: stats.rows[0],
      recentActivity: recentActivity.rows
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
