import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import {
	uploadMediaFile,
	getUserMedia,
	getMediaById,
	deleteMediaFile,
	getUserStorageStats,
	detectFileType
} from '../services/media.service.js';

const media = new Hono();

// All media routes require authentication
media.use('/*', authMiddleware);

// Upload media (supports all file types)
media.post('/upload', async (c) => {
	try {
		const user = c.get('user');

		// Parse multipart form data
		const formData = await c.req.formData();
		const file = formData.get('file');
		let mediaType = formData.get('type'); // Optional, can auto-detect

		if (!file) {
			return c.json({ error: 'No file provided' }, 400);
		}

		// Auto-detect type if not provided
		if (!mediaType) {
			mediaType = detectFileType(file);
			if (!mediaType) {
				return c.json({
					error: 'Could not detect file type. Please specify type parameter.'
				}, 400);
			}
		}

		// Validate media type
		const validTypes = [
			'image', 'gif', 'audio', 'video', 'pdf',
			'document', 'spreadsheet', 'presentation', 'archive', 'code'
		];

		if (!validTypes.includes(mediaType)) {
			return c.json({
				error: `Invalid media type. Must be one of: ${validTypes.join(', ')}`
			}, 400);
		}

		// Upload file
		const result = await uploadMediaFile(file, mediaType, user.id);

		return c.json({
			message: 'Media uploaded successfully',
			data: result.data
		}, 201);
	} catch (error) {
		console.error('Media upload error:', error);
		return c.json({
			error: error.message || 'Failed to upload media'
		}, 400);
	}
});

// Get user's uploaded media
media.get('/my-media', async (c) => {
	try {
		const user = c.get('user');
		const limit = parseInt(c.req.query('limit') || '50');
		const offset = parseInt(c.req.query('offset') || '0');

		const mediaList = await getUserMedia(user.id, limit, offset);

		return c.json({
			count: mediaList.length,
			media: mediaList
		});
	} catch (error) {
		console.error('Get media error:', error);
		return c.json({
			error: error.message || 'Failed to get media'
		}, 400);
	}
});

// Get media by ID
media.get('/:mediaId', async (c) => {
	try {
		const mediaId = c.req.param('mediaId');
		const mediaFile = await getMediaById(mediaId);

		return c.json({
			media: mediaFile
		});
	} catch (error) {
		console.error('Get media error:', error);
		return c.json({
			error: error.message || 'Media not found'
		}, 404);
	}
});

// Delete media
media.delete('/:mediaId', async (c) => {
	try {
		const user = c.get('user');
		const mediaId = c.req.param('mediaId');

		const result = await deleteMediaFile(mediaId, user.id);

		return c.json(result);
	} catch (error) {
		console.error('Delete media error:', error);
		return c.json({
			error: error.message || 'Failed to delete media'
		}, 400);
	}
});

// Get storage statistics
media.get('/stats/storage', async (c) => {
	try {
		const user = c.get('user');
		const stats = await getUserStorageStats(user.id);

		return c.json({
			storage: stats
		});
	} catch (error) {
		console.error('Get storage stats error:', error);
		return c.json({
			error: error.message || 'Failed to get storage stats'
		}, 400);
	}
});

export default media;
