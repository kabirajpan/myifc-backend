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

export default cloudinary;
