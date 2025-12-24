import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

// Configure Cloudinary
cloudinary.config({
	cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
	api_key: process.env.CLOUDINARY_API_KEY,
	api_secret: process.env.CLOUDINARY_API_SECRET,
	secure: true
});

// Settings
export const CLOUDINARY_FOLDER = process.env.CLOUDINARY_FOLDER || 'anonymous_chat';
export const MAX_IMAGE_SIZE_MB = parseInt(process.env.MAX_IMAGE_SIZE_MB) || 10;
export const MAX_GIF_SIZE_MB = parseInt(process.env.MAX_GIF_SIZE_MB) || 10;
export const MAX_AUDIO_DURATION_SEC = parseInt(process.env.MAX_AUDIO_DURATION_SEC) || 10;

// Signed URL settings (24 hours expiry - same as message expiry)
export const SIGNED_URL_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

// Media upload settings
export const MEDIA_SETTINGS = {
	images: {
		maxSize: MAX_IMAGE_SIZE_MB * 1024 * 1024, // Convert to bytes
		formats: ['avif', 'webp'], // Try AVIF first, fallback to WebP
		quality: 80
	},
	gifs: {
		maxSize: MAX_GIF_SIZE_MB * 1024 * 1024,
		format: 'gif'
	},
	audio: {
		maxDuration: MAX_AUDIO_DURATION_SEC,
		format: 'mp3'
	}
};

// Generate signed URL for private resources
export function generateSignedUrl(publicId, resourceType = 'image') {
	try {
		const options = {
			resource_type: resourceType,
			type: 'authenticated', // Use authenticated type for private URLs
			secure: true,
			sign_url: true,
			expires_at: Math.floor(Date.now() / 1000) + SIGNED_URL_EXPIRY_SECONDS
		};

		// Generate signed URL
		const signedUrl = cloudinary.url(publicId, options);

		return signedUrl;
	} catch (error) {
		console.error('Generate signed URL error:', error);
		throw new Error('Failed to generate signed URL');
	}
}

export default cloudinary;
