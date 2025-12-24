import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { uploadMediaFile } from '../services/media.service.js';

const media = new Hono();

// All media routes require authentication
media.use('/*', authMiddleware);

// Upload media (image, gif, or audio)
media.post('/upload', async (c) => {
	try {
		const user = c.get('user');
		const body = await c.req.parseBody();

		const file = body.file;
		const mediaType = body.type; // 'image', 'gif', or 'audio'

		if (!file) {
			return c.json({ error: 'No file provided' }, 400);
		}

		if (!mediaType || !['image', 'gif', 'audio'].includes(mediaType)) {
			return c.json({ error: 'Invalid media type. Must be: image, gif, or audio' }, 400);
		}

		// Upload to Cloudinary (PRIVATE)
		const result = await uploadMediaFile(file, mediaType, user.id);

		return c.json({
			message: 'Media uploaded successfully',
			data: {
				public_id: result.data.public_id, // Return public_id (NOT URL)
				format: result.data.format,
				size: result.data.size,
				duration: result.data.duration,
				type: result.data.type
			}
		}, 201);

	} catch (error) {
		console.error('Media upload error:', error);
		return c.json({
			error: error.message || 'Failed to upload media'
		}, 400);
	}
});

export default media;
