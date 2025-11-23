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

// ============ ISSUE ROUTES ============

// Create a new issue with optional display picture and attachments
app.post("/issues", authenticateToken, (req, res) => {
  uploadIssueFiles(req, res, async (err) => {
    if (err) {
      console.error("Upload error:", err);
      return res.status(400).json({ error: err.message });
    }

    try {
      const { title, description, group_id } = req.body;
      const userId = req.user.userId;

      if (!title || !description) {
        return res.status(400).json({ error: "Title and description are required" });
      }

      // Get display picture path if uploaded
      let displayPictureUrl = null;
      if (req.files && req.files['display_picture'] && req.files['display_picture'][0]) {
        const file = req.files['display_picture'][0];
        displayPictureUrl = `/uploads/issues/${file.filename}`;
      }

      // Insert issue
      const issueResult = await pool.query(
        `INSERT INTO issues (title, description, user_id, group_id, display_picture_url, upvote_count, comment_count)
         VALUES ($1, $2, $3, $4, $5, 0, 0)
         RETURNING issue_id, title, description, user_id, group_id, display_picture_url, upvote_count, comment_count, posted_at`,
        [title, description, userId, group_id || null, displayPictureUrl]
      );

      const issue = issueResult.rows[0];

      // Insert attachments if any
      const attachments = [];
      if (req.files && req.files['attachments']) {
        for (const file of req.files['attachments']) {
          const filePath = `/uploads/attachments/${file.filename}`;
          const attachmentResult = await pool.query(
            `INSERT INTO post_attachments (issue_id, uploaded_by, file_path)
             VALUES ($1, $2, $3)
             RETURNING attachment_id, file_path, created_at`,
            [issue.issue_id, userId, filePath]
          );
          attachments.push(attachmentResult.rows[0]);
        }
      }

      res.status(201).json({
        issue_id: issue.issue_id,
        title: issue.title,
        description: issue.description,
        user_id: issue.user_id,
        group_id: issue.group_id,
        display_picture_url: issue.display_picture_url,
        upvote_count: issue.upvote_count,
        comment_count: issue.comment_count,
        posted_at: issue.posted_at,
        attachments: attachments
      });
    } catch (error) {
      console.error("Error creating issue:", error);
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

    res.json({
      items: combined,
      count: combined.length
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

      // Decrement count
      const result = await pool.query(
        `UPDATE issues SET upvote_count = upvote_count - 1 
         WHERE issue_id = $1 
         RETURNING upvote_count`,
        [id]
      );

      res.json({ upvoted: false, upvote_count: result.rows[0].upvote_count });
    } else {
      // Add upvote
      await pool.query(
        `INSERT INTO issue_upvotes (issue_id, user_id) VALUES ($1, $2)`,
        [id, userId]
      );

      // Increment count
      const result = await pool.query(
        `UPDATE issues SET upvote_count = upvote_count + 1 
         WHERE issue_id = $1 
         RETURNING upvote_count`,
        [id]
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

    try {
      const { name, description } = req.body;
      const userId = req.user.userId;

      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }

      // Get display picture path if uploaded
      let displayPictureUrl = null;
      if (req.files && req.files['display_picture'] && req.files['display_picture'][0]) {
        const file = req.files['display_picture'][0];
        displayPictureUrl = `/uploads/issues/${file.filename}`;
      }

      // Insert group
      const result = await pool.query(
        `INSERT INTO groups (name, description, owner_id, display_picture_url, upvote_count, comment_count)
         VALUES ($1, $2, $3, $4, 0, 0)
         RETURNING group_id, name, description, owner_id, display_picture_url, upvote_count, comment_count, created_at`,
        [name, description || null, userId, displayPictureUrl]
      );

      const group = result.rows[0];

      res.status(201).json({
        group_id: group.group_id,
        name: group.name,
        description: group.description,
        owner_id: group.owner_id,
        display_picture_url: group.display_picture_url,
        upvote_count: group.upvote_count,
        comment_count: group.comment_count,
        created_at: group.created_at
      });
    } catch (error) {
      console.error("Error creating group:", error);
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

    // Check authorization: either issue owner or group owner
    if (requested_by_group) {
      // Group owner is requesting to include an issue
      const groupCheck = await pool.query(
        "SELECT owner_id FROM groups WHERE group_id = $1",
        [group_id]
      );
      if (groupCheck.rows.length === 0) {
        return res.status(404).json({ error: "Group not found" });
      }
      if (groupCheck.rows[0].owner_id !== userId) {
        return res.status(403).json({ error: "Only group owner can make this request" });
      }
    } else {
      // Issue owner is requesting to join a group
      const issueCheck = await pool.query(
        "SELECT user_id FROM issues WHERE issue_id = $1",
        [issue_id]
      );
      if (issueCheck.rows.length === 0) {
        return res.status(404).json({ error: "Issue not found" });
      }
      if (issueCheck.rows[0].user_id !== userId) {
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

    // Create the request
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

// Start the server
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
