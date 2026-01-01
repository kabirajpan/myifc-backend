import { MAX_IMAGE_SIZE_MB, MAX_GIF_SIZE_MB, MAX_AUDIO_DURATION_SEC } from '../config/cloudinary.js';

// Define file size limits (in MB) per plan
export const FILE_SIZE_LIMITS = {
	free: {
		perFile: 10, // 10MB per file
		total: 100   // 100MB total storage
	},
	pro: {
		perFile: 100,  // 100MB per file
		total: 10240   // 10GB total storage
	}
};

// Define allowed file types
const ALLOWED_FILE_TYPES = {
	image: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif'],
	gif: ['image/gif'],
	audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm'],
	video: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'],
	pdf: ['application/pdf'],
	document: [
		'application/msword',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		'text/plain'
	],
	spreadsheet: [
		'application/vnd.ms-excel',
		'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		'text/csv'
	],
	presentation: [
		'application/vnd.ms-powerpoint',
		'application/vnd.openxmlformats-officedocument.presentationml.presentation'
	],
	archive: [
		'application/zip',
		'application/x-zip-compressed',
		'application/x-rar-compressed',
		'application/x-7z-compressed'
	],
	code: [
		'text/javascript',
		'application/javascript',
		'text/html',
		'text/css',
		'application/json',
		'text/x-python',
		'application/x-python-code'
	]
};

// Validate file type
export function validateFileType(mimetype, expectedType) {
	return ALLOWED_FILE_TYPES[expectedType]?.includes(mimetype) || false;
}

// Validate file size based on user plan
export function validateFileSize(fileSize, plan = 'free') {
	const maxSizeBytes = FILE_SIZE_LIMITS[plan].perFile * 1024 * 1024;
	return fileSize <= maxSizeBytes;
}

// Check if user has enough storage
export function checkStorageAvailable(currentUsage, fileSize, plan = 'free') {
	const totalLimit = FILE_SIZE_LIMITS[plan].total * 1024 * 1024;
	const newUsage = currentUsage + fileSize;

	return {
		allowed: newUsage <= totalLimit,
		currentUsage,
		fileSize,
		newUsage,
		limit: totalLimit,
		remaining: totalLimit - currentUsage
	};
}

// Validate image
export function validateImage(file, plan = 'free') {
	const errors = [];

	if (!validateFileType(file.type, 'image')) {
		errors.push('Invalid image format. Allowed: JPEG, PNG, WebP, AVIF');
	}

	if (!validateFileSize(file.size, plan)) {
		errors.push(`Image size must be less than ${FILE_SIZE_LIMITS[plan].perFile}MB`);
	}

	return {
		valid: errors.length === 0,
		errors
	};
}

// Validate GIF
export function validateGif(file, plan = 'free') {
	const errors = [];

	if (!validateFileType(file.type, 'gif')) {
		errors.push('Invalid file format. Must be a GIF');
	}

	if (!validateFileSize(file.size, plan)) {
		errors.push(`GIF size must be less than ${FILE_SIZE_LIMITS[plan].perFile}MB`);
	}

	return {
		valid: errors.length === 0,
		errors
	};
}

// Validate audio
export function validateAudio(file, plan = 'free') {
	const errors = [];

	if (!validateFileType(file.type, 'audio')) {
		errors.push('Invalid audio format. Allowed: MP3, WAV, OGG, WebM');
	}

	if (!validateFileSize(file.size, plan)) {
		errors.push(`Audio size must be less than ${FILE_SIZE_LIMITS[plan].perFile}MB`);
	}

	return {
		valid: errors.length === 0,
		errors
	};
}

// Validate video
export function validateVideo(file, plan = 'free') {
	const errors = [];

	if (!validateFileType(file.type, 'video')) {
		errors.push('Invalid video format. Allowed: MP4, MOV, WebM, AVI');
	}

	if (!validateFileSize(file.size, plan)) {
		errors.push(`Video size must be less than ${FILE_SIZE_LIMITS[plan].perFile}MB`);
	}

	return {
		valid: errors.length === 0,
		errors
	};
}

// Validate PDF
export function validatePdf(file, plan = 'free') {
	const errors = [];

	if (!validateFileType(file.type, 'pdf')) {
		errors.push('Invalid file format. Must be a PDF');
	}

	if (!validateFileSize(file.size, plan)) {
		errors.push(`PDF size must be less than ${FILE_SIZE_LIMITS[plan].perFile}MB`);
	}

	return {
		valid: errors.length === 0,
		errors
	};
}

// Validate document
export function validateDocument(file, plan = 'free') {
	const errors = [];

	if (!validateFileType(file.type, 'document')) {
		errors.push('Invalid document format. Allowed: DOCX, DOC, TXT');
	}

	if (!validateFileSize(file.size, plan)) {
		errors.push(`Document size must be less than ${FILE_SIZE_LIMITS[plan].perFile}MB`);
	}

	return {
		valid: errors.length === 0,
		errors
	};
}

// Validate spreadsheet
export function validateSpreadsheet(file, plan = 'free') {
	const errors = [];

	if (!validateFileType(file.type, 'spreadsheet')) {
		errors.push('Invalid spreadsheet format. Allowed: XLSX, XLS, CSV');
	}

	if (!validateFileSize(file.size, plan)) {
		errors.push(`Spreadsheet size must be less than ${FILE_SIZE_LIMITS[plan].perFile}MB`);
	}

	return {
		valid: errors.length === 0,
		errors
	};
}

// Validate presentation
export function validatePresentation(file, plan = 'free') {
	const errors = [];

	if (!validateFileType(file.type, 'presentation')) {
		errors.push('Invalid presentation format. Allowed: PPTX, PPT');
	}

	if (!validateFileSize(file.size, plan)) {
		errors.push(`Presentation size must be less than ${FILE_SIZE_LIMITS[plan].perFile}MB`);
	}

	return {
		valid: errors.length === 0,
		errors
	};
}

// Validate archive
export function validateArchive(file, plan = 'free') {
	const errors = [];

	if (!validateFileType(file.type, 'archive')) {
		errors.push('Invalid archive format. Allowed: ZIP, RAR, 7Z');
	}

	if (!validateFileSize(file.size, plan)) {
		errors.push(`Archive size must be less than ${FILE_SIZE_LIMITS[plan].perFile}MB`);
	}

	return {
		valid: errors.length === 0,
		errors
	};
}

// Validate code file
export function validateCode(file, plan = 'free') {
	const errors = [];

	if (!validateFileType(file.type, 'code')) {
		errors.push('Invalid code file format. Allowed: JS, HTML, CSS, JSON, PY');
	}

	if (!validateFileSize(file.size, plan)) {
		errors.push(`Code file size must be less than ${FILE_SIZE_LIMITS[plan].perFile}MB`);
	}

	return {
		valid: errors.length === 0,
		errors
	};
}

// Main validator
export function validateMedia(file, mediaType, plan = 'free') {
	if (!file) {
		return { valid: false, errors: ['No file provided'] };
	}

	switch (mediaType) {
		case 'image':
			return validateImage(file, plan);
		case 'gif':
			return validateGif(file, plan);
		case 'audio':
			return validateAudio(file, plan);
		case 'video':
			return validateVideo(file, plan);
		case 'pdf':
			return validatePdf(file, plan);
		case 'document':
			return validateDocument(file, plan);
		case 'spreadsheet':
			return validateSpreadsheet(file, plan);
		case 'presentation':
			return validatePresentation(file, plan);
		case 'archive':
			return validateArchive(file, plan);
		case 'code':
			return validateCode(file, plan);
		default:
			return { valid: false, errors: ['Invalid media type'] };
	}
}

// Get file extension from filename
export function getFileExtension(filename) {
	return filename.split('.').pop().toLowerCase();
}

// Detect media type from mimetype
export function detectMediaType(mimetype) {
	for (const [type, mimetypes] of Object.entries(ALLOWED_FILE_TYPES)) {
		if (mimetypes.includes(mimetype)) {
			return type;
		}
	}
	return null;
}
