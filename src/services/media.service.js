import { db } from '../config/db.js';
import { generateId } from '../utils/idGenerator.js';
import {
	uploadImage,
	uploadGif,
	uploadAudio,
	uploadVideo,
	uploadPdf,
	uploadRawFile,
	deleteMedia
} from '../utils/mediaProcessor.js';
import {
	validateMedia,
	checkStorageAvailable,
	detectMediaType
} from '../utils/mediaValidator.js';

// Upload media file (with storage tracking)
export async function uploadMediaFile(file, mediaType, userId) {
	try {
		// Get user info (for plan and storage)
		const userResult = await db.execute({
			sql: 'SELECT plan, storage_used FROM users WHERE id = ?',
			args: [userId]
		});

		if (userResult.rows.length === 0) {
			throw new Error('User not found');
		}

		const user = userResult.rows[0];
		const plan = user.plan || 'free';
		const currentStorage = user.storage_used || 0;

		// Check storage availability
		const storageCheck = checkStorageAvailable(currentStorage, file.size, plan);

		if (!storageCheck.allowed) {
			throw new Error(
				`Storage limit exceeded. Used: ${Math.round(storageCheck.currentUsage / (1024 * 1024))}MB, ` +
				`Limit: ${Math.round(storageCheck.limit / (1024 * 1024))}MB`
			);
		}

		// Validate file
		const validation = validateMedia(file, mediaType, plan);

		if (!validation.valid) {
			throw new Error(validation.errors.join(', '));
		}

		// Get file buffer
		const arrayBuffer = await file.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		// Upload based on type
		let uploadResult;
		const filename = file.name || 'untitled';

		switch (mediaType) {
			case 'image':
				uploadResult = await uploadImage(buffer, userId);
				break;
			case 'gif':
				uploadResult = await uploadGif(buffer, userId);
				break;
			case 'audio':
				uploadResult = await uploadAudio(buffer, userId);
				break;
			case 'video':
				uploadResult = await uploadVideo(buffer, userId);
				break;
			case 'pdf':
				uploadResult = await uploadPdf(buffer, userId, filename);
				break;
			case 'document':
			case 'spreadsheet':
			case 'presentation':
			case 'archive':
			case 'code':
				uploadResult = await uploadRawFile(buffer, userId, filename, mediaType);
				break;
			default:
				throw new Error('Unsupported media type');
		}

		// Save to database
		const mediaId = generateId();
		const now = Date.now();

		await db.execute({
			sql: `INSERT INTO media (id, public_id, user_id, url, type, filename, size, created_at)
			      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			args: [
				mediaId,
				uploadResult.public_id,
				userId,
				uploadResult.url,
				mediaType,
				filename,
				uploadResult.size,
				now
			]
		});

		// Update user storage
		await db.execute({
			sql: 'UPDATE users SET storage_used = storage_used + ? WHERE id = ?',
			args: [uploadResult.size, userId]
		});

		console.log(`✅ Uploaded ${mediaType} for user ${userId}, size: ${uploadResult.size} bytes`);

		return {
			success: true,
			data: {
				id: mediaId,
				public_id: uploadResult.public_id,
				url: uploadResult.url,
				type: mediaType,
				filename: filename,
				format: uploadResult.format,
				size: uploadResult.size,
				duration: uploadResult.duration || null,
				created_at: now
			}
		};
	} catch (error) {
		console.error('Media upload error:', error);
		throw error;
	}
}

// Get media by ID
export async function getMediaById(mediaId) {
	const result = await db.execute({
		sql: 'SELECT * FROM media WHERE id = ?',
		args: [mediaId]
	});

	if (result.rows.length === 0) {
		throw new Error('Media not found');
	}

	return result.rows[0];
}

// Get all media for a user
export async function getUserMedia(userId, limit = 50, offset = 0) {
	const result = await db.execute({
		sql: 'SELECT * FROM media WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
		args: [userId, limit, offset]
	});

	return result.rows;
}

// Delete media (and update storage)
export async function deleteMediaFile(mediaId, userId) {
	try {
		// Get media info
		const media = await getMediaById(mediaId);

		// Check ownership (or admin)
		const userResult = await db.execute({
			sql: 'SELECT role FROM users WHERE id = ?',
			args: [userId]
		});

		const isOwner = media.user_id === userId;
		const isAdmin = userResult.rows[0]?.role === 'admin';

		if (!isOwner && !isAdmin) {
			throw new Error('Permission denied');
		}

		// Delete from Cloudinary
		await deleteMedia(media.public_id, media.type);

		// Delete from database
		await db.execute({
			sql: 'DELETE FROM media WHERE id = ?',
			args: [mediaId]
		});

		// Update user storage
		await db.execute({
			sql: 'UPDATE users SET storage_used = storage_used - ? WHERE id = ?',
			args: [media.size, media.user_id]
		});

		console.log(`✅ Deleted ${media.type} ${mediaId}, freed ${media.size} bytes`);

		return {
			success: true,
			message: 'Media deleted successfully',
			freed_bytes: media.size
		};
	} catch (error) {
		console.error('Delete media error:', error);
		throw error;
	}
}

// Get storage stats for user
export async function getUserStorageStats(userId) {
	const userResult = await db.execute({
		sql: 'SELECT plan, storage_used FROM users WHERE id = ?',
		args: [userId]
	});

	if (userResult.rows.length === 0) {
		throw new Error('User not found');
	}

	const user = userResult.rows[0];
	const plan = user.plan || 'free';
	const used = user.storage_used || 0;

	const limits = {
		free: 100 * 1024 * 1024,      // 100MB
		pro: 10 * 1024 * 1024 * 1024  // 10GB
	};

	const limit = limits[plan];
	const remaining = limit - used;
	const percentage = (used / limit) * 100;

	// Get media breakdown by type
	const mediaBreakdown = await db.execute({
		sql: `SELECT type, COUNT(*) as count, SUM(size) as total_size 
		      FROM media 
		      WHERE user_id = ? 
		      GROUP BY type`,
		args: [userId]
	});

	return {
		plan,
		used,
		limit,
		remaining,
		percentage: Math.round(percentage * 100) / 100,
		formatted: {
			used: formatBytes(used),
			limit: formatBytes(limit),
			remaining: formatBytes(remaining)
		},
		breakdown: mediaBreakdown.rows.map(row => ({
			type: row.type,
			count: row.count,
			size: row.total_size,
			formatted: formatBytes(row.total_size)
		}))
	};
}

// Helper: Format bytes
function formatBytes(bytes) {
	if (bytes === 0) return '0 Bytes';
	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Auto-detect media type from file
export function detectFileType(file) {
	return detectMediaType(file.type);
}
