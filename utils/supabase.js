import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_STORAGE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

let supabaseClient = null;

/**
 * Get or create Supabase client instance (singleton)
 */
export function getSupabaseClient() {

    console.log("ERER")
    console.log(process.env.SUPABASE_STORAGE_URL);
    console.log(process.env.SUPABASE_SERVICE_KEY);

    if (!supabaseClient) {
        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error('Missing Supabase configuration. Check SUPABASE_STORAGE_URL and SUPABASE_SERVICE_KEY in .env');
        }

        supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                persistSession: false
            }
        });
    }

    return supabaseClient;
}

/**
 * Generate a unique filename with timestamp and random suffix
 * @param {string} originalName - Original filename
 * @param {string} prefix - Prefix for the file (e.g., 'issue', 'attachment')
 * @returns {string} Generated filename
 */
export function generateUniqueFileName(originalName, prefix = 'file') {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1E9);
    const extension = originalName.substring(originalName.lastIndexOf('.'));
    return `${prefix}-${timestamp}-${random}${extension}`;
}

/**
 * Upload a file to Supabase Storage
 * @param {Object} params
 * @param {string} params.bucket - Bucket name (should be 'uploads')
 * @param {string} params.folder - Folder path (e.g., 'issues', 'attachments')
 * @param {Buffer} params.file - File buffer from multer
 * @param {string} params.fileName - Generated unique filename
 * @param {string} params.contentType - MIME type
 * @returns {Promise<{storagePath: string}>} Storage path
 */
export async function uploadToSupabase({ bucket, folder, file, fileName, contentType }) {
    const client = getSupabaseClient();

    // Construct the storage path: folder/filename
    const storagePath = `${folder}/${fileName}`;

    const { data, error } = await client.storage
        .from(bucket)
        .upload(storagePath, file, {
            contentType,
            upsert: false // Don't overwrite existing files
        });

    if (error) {
        console.error('Supabase upload error:', error);
        throw new Error(`Failed to upload file: ${error.message}`);
    }

    return { storagePath };
}

/**
 * Generate a signed URL for a file in Supabase Storage
 * @param {string} bucket - Bucket name
 * @param {string} storagePath - Path to file in storage (e.g., 'issues/issue-123.jpg')
 * @param {number} expiresIn - Expiration time in seconds (default: 3600 = 1 hour)
 * @returns {Promise<string>} Signed URL
 */
export async function getSignedUrl(bucket, storagePath, expiresIn = null) {
    if (!storagePath) return null;

    const client = getSupabaseClient();
    const expiry = expiresIn || parseInt(process.env.SIGNED_URL_EXPIRY_SECONDS || '3600');

    const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(storagePath, expiry);

    if (error) {
        console.error('Error generating signed URL:', error);
        return null;
    }

    return data.signedUrl;
}

/**
 * Delete a file from Supabase Storage
 * @param {string} bucket - Bucket name
 * @param {string} storagePath - Path to file in storage
 * @returns {Promise<boolean>} Success status
 */
export async function deleteFromSupabase(bucket, storagePath) {
    if (!storagePath) return false;

    const client = getSupabaseClient();

    const { error } = await client.storage
        .from(bucket)
        .remove([storagePath]);

    if (error) {
        console.error('Error deleting file from Supabase:', error);
        return false;
    }

    return true;
}

/**
 * Helper to enrich issue/group object with signed URLs
 * @param {Object} item - Issue or group object
 * @param {string} bucket - Bucket name (default: 'uploads')
 * @returns {Promise<Object>} Item with signed URLs
 */
export async function enrichWithSignedUrls(item, bucket = 'uploads') {
    if (!item) return item;

    // Handle display picture
    if (item.display_picture_url && !item.display_picture_url.startsWith('http')) {
        item.display_picture_url = await getSignedUrl(bucket, item.display_picture_url);
    }

    // Handle attachments array if present
    if (item.attachments && Array.isArray(item.attachments)) {
        for (const attachment of item.attachments) {
            if (attachment.file_path && !attachment.file_path.startsWith('http')) {
                attachment.file_path = await getSignedUrl(bucket, attachment.file_path);
            }
        }
    }

    return item;
}
