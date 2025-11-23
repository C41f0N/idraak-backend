# Issue Endpoints Testing Guide

## Prerequisites
1. Run the migration to add display_picture_url column:
```bash
# You need to apply the migration manually to your database
# The SQL is in: migrations/add_display_picture_to_issues.sql
```

2. Make sure backend is running:
```bash
npm start
```

## Endpoints Implemented

### 1. Create Issue (POST /issues)
Creates a new issue with optional display picture and attachments.

**Headers:**
- `Authorization: Bearer YOUR_JWT_TOKEN`

**Form Data:**
- `title` (required): Issue title
- `description` (required): Issue description
- `group_id` (optional): UUID of group this issue belongs to
- `display_picture` (optional): Image file for the issue (max 5MB, jpg/png/gif/webp)
- `attachments` (optional): Up to 5 files (max 10MB each, images/pdf/docs)

**Example with curl:**
```bash
TOKEN="your-jwt-token-here"

# Create issue with display picture
curl -X POST http://localhost:3000/issues \
  -H "Authorization: Bearer $TOKEN" \
  -F "title=Broken street light on Main St" \
  -F "description=The street light has been broken for 2 weeks causing safety issues" \
  -F "display_picture=@/path/to/photo.jpg"

# Create issue with display picture and attachments
curl -X POST http://localhost:3000/issues \
  -H "Authorization: Bearer $TOKEN" \
  -F "title=Pothole on Highway 5" \
  -F "description=Large pothole causing accidents" \
  -F "display_picture=@/path/to/main-photo.jpg" \
  -F "attachments=@/path/to/document1.pdf" \
  -F "attachments=@/path/to/photo2.jpg"
```

**Response:**
```json
{
  "issue_id": "uuid",
  "title": "Broken street light on Main St",
  "description": "The street light has been broken...",
  "user_id": "uuid",
  "group_id": null,
  "display_picture_url": "/uploads/issues/issue-1234567890-123456789.jpg",
  "upvote_count": 0,
  "comment_count": 0,
  "posted_at": "2025-11-23T...",
  "attachments": [
    {
      "attachment_id": "uuid",
      "file_path": "/uploads/attachments/attachment-1234567890-123456789.pdf",
      "created_at": "2025-11-23T..."
    }
  ]
}
```

### 2. Get All Issues (GET /issues)
Retrieves a paginated list of issues.

**Headers:**
- `Authorization: Bearer YOUR_JWT_TOKEN`

**Query Parameters:**
- `limit` (optional, default: 20): Number of issues to return
- `offset` (optional, default: 0): Pagination offset
- `group_id` (optional): Filter by group ID

**Example:**
```bash
TOKEN="your-jwt-token-here"

# Get first 20 issues
curl http://localhost:3000/issues \
  -H "Authorization: Bearer $TOKEN"

# Get next 20 issues
curl http://localhost:3000/issues?offset=20&limit=20 \
  -H "Authorization: Bearer $TOKEN"

# Get issues for a specific group
curl http://localhost:3000/issues?group_id=GROUP_UUID \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "issues": [
    {
      "issue_id": "uuid",
      "title": "Broken street light",
      "description": "...",
      "user_id": "uuid",
      "username": "john_doe",
      "full_name": "John Doe",
      "group_id": null,
      "display_picture_url": "/uploads/issues/...",
      "upvote_count": 15,
      "comment_count": 3,
      "posted_at": "2025-11-23T...",
      "attachment_count": 2
    }
  ],
  "limit": 20,
  "offset": 0,
  "count": 15
}
```

### 3. Get Single Issue (GET /issues/:id)
Retrieves detailed information about a specific issue including attachments.

**Headers:**
- `Authorization: Bearer YOUR_JWT_TOKEN`

**Example:**
```bash
TOKEN="your-jwt-token-here"
ISSUE_ID="issue-uuid-here"

curl http://localhost:3000/issues/$ISSUE_ID \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "issue_id": "uuid",
  "title": "Broken street light",
  "description": "...",
  "user_id": "uuid",
  "username": "john_doe",
  "full_name": "John Doe",
  "group_id": null,
  "display_picture_url": "/uploads/issues/...",
  "upvote_count": 15,
  "comment_count": 3,
  "posted_at": "2025-11-23T...",
  "attachments": [
    {
      "attachment_id": "uuid",
      "file_path": "/uploads/attachments/...",
      "created_at": "2025-11-23T...",
      "uploaded_by": "uuid"
    }
  ]
}
```

### 4. Toggle Upvote (POST /issues/:id/upvote)
Upvotes or removes upvote from an issue.

**Headers:**
- `Authorization: Bearer YOUR_JWT_TOKEN`

**Example:**
```bash
TOKEN="your-jwt-token-here"
ISSUE_ID="issue-uuid-here"

curl -X POST http://localhost:3000/issues/$ISSUE_ID/upvote \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "upvoted": true,
  "upvote_count": 16
}
```

## File Storage
- Display pictures are stored in: `uploads/issues/`
- Attachments are stored in: `uploads/attachments/`
- Files are accessible via: `http://localhost:3000/uploads/issues/filename.jpg`

## Notes
- All endpoints require JWT authentication
- Display pictures must be images (jpg, png, gif, webp)
- Attachments can be images, PDFs, or documents
- Maximum file sizes:
  - Display pictures: 5MB
  - Attachments: 10MB each
  - Maximum 5 attachments per issue
- The `comment_count` is automatically calculated from the comments table
