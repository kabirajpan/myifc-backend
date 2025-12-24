import { MAX_IMAGE_SIZE_MB, MAX_GIF_SIZE_MB, MAX_AUDIO_DURATION_SEC } from '../config/cloudinary.js';

// Validate file type
export function validateFileType(mimetype, expectedType) {
	const typeMap = {
		image: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif'],
		gif: ['image/gif'],
		audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm']
	};

	return typeMap[expectedType]?.includes(mimetype) || false;
}

// Validate file size
export function validateFileSize(fileSize, maxSizeMB) {
	const maxSizeBytes = maxSizeMB * 1024 * 1024;
	return fileSize <= maxSizeBytes;
}

// Validate image
export function validateImage(file) {
	const errors = [];

	if (!validateFileType(file.type, 'image')) {
		errors.push('Invalid image format. Allowed: JPEG, PNG, WebP, AVIF');
	}

	if (!validateFileSize(file.size, MAX_IMAGE_SIZE_MB)) {
		errors.push(`Image size must be less than ${MAX_IMAGE_SIZE_MB}MB`);
	}

	return {
		valid: errors.length === 0,
		errors
	};
}

// Validate GIF
export function validateGif(file) {
	const errors = [];

	if (!validateFileType(file.type, 'gif')) {
		errors.push('Invalid file format. Must be a GIF');
	}

	if (!validateFileSize(file.size, MAX_GIF_SIZE_MB)) {
		errors.push(`GIF size must be less than ${MAX_GIF_SIZE_MB}MB`);
	}

	return {
		valid: errors.length === 0,
		errors
	};
}

// Validate audio
export function validateAudio(file) {
	const errors = [];

	if (!validateFileType(file.type, 'audio')) {
		errors.push('Invalid audio format. Allowed: MP3, WAV, OGG, WebM');
	}

	// Note: Duration validation will be done after upload/processing
	// as we can't reliably check duration from file object alone

	return {
		valid: errors.length === 0,
		errors
	};
}

// Main validator
export function validateMedia(file, mediaType) {
	if (!file) {
		return { valid: false, errors: ['No file provided'] };
	}

	switch (mediaType) {
		case 'image':
			return validateImage(file);
		case 'gif':
			return validateGif(file);
		case 'audio':
			return validateAudio(file);
		default:
			return { valid: false, errors: ['Invalid media type'] };
	}
}
