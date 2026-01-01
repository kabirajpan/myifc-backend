import { validateMedia } from '../utils/mediaValidator.js';
import { uploadImage, uploadGif, uploadAudio, deleteMedia } from '../utils/mediaProcessor.js';

// media.service.js
export async function uploadMediaFile(file, mediaType, userId) {
	const validation = validateMedia(file, mediaType);
	if (!validation.valid) throw new Error(validation.errors.join(', '));

	const buffer = Buffer.from(await file.arrayBuffer());
	let result;

	switch (mediaType) {
		case 'image':
			result = await uploadImage(buffer, userId);
			break;
		case 'gif':
			result = await uploadGif(buffer, userId);
			break;
		case 'audio':
			result = await uploadAudio(buffer, userId);
			break;
		default:
			throw new Error('Invalid media type');
	}

	// Return URL directly for all media types (now public)
	return {
		success: true,
		data: {
			public_id: result.public_id,
			url: result.url, // All media now uses public URL
			format: result.format,
			size: result.size,
			duration: result.duration || null,
			type: mediaType
		}
	};
}

// Delete media file from Cloudinary
export async function deleteMediaFile(publicId, mediaType) {
	try {
		const result = await deleteMedia(publicId, mediaType);
		if (result.result === 'ok' || result.result === 'not found') {
			return { success: true, message: 'Media deleted successfully' };
		}
		throw new Error('Failed to delete media');
	} catch (error) {
		console.error('Delete media service error:', error);
		throw error;
	}
}

// Extract public_id from Cloudinary URL
export function extractPublicIdFromUrl(url) {
	try {
		// Cloudinary URL format: https://res.cloudinary.com/{cloud_name}/{resource_type}/upload/v{version}/{public_id}.{format}
		const urlParts = url.split('/');
		const uploadIndex = urlParts.indexOf('upload');
		if (uploadIndex === -1) {
			throw new Error('Invalid Cloudinary URL');
		}
		// Get everything after 'upload/v{version}/'
		const publicIdWithFormat = urlParts.slice(uploadIndex + 2).join('/');
		// Remove file extension
		const publicId = publicIdWithFormat.substring(0, publicIdWithFormat.lastIndexOf('.'));
		return publicId;
	} catch (error) {
		console.error('Extract public_id error:', error);
		throw new Error('Failed to extract public_id from URL');
	}
}

// Check if content is a public_id or URL
export function isPublicId(content) {
	// If it doesn't start with http/https, it's a public_id
	return !content.startsWith('http://') && !content.startsWith('https://');
}
