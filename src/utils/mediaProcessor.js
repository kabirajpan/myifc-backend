import cloudinary, { CLOUDINARY_FOLDER, MEDIA_SETTINGS, MAX_AUDIO_DURATION_SEC } from '../config/cloudinary.js';
import { generateId } from './idGenerator.js';

// Upload image to Cloudinary (PRIVATE - with auto-compression)
export async function uploadImage(buffer, userId) {
	try {
		const filename = `${generateId()}_${userId}`;

		return new Promise((resolve, reject) => {
			const uploadStream = cloudinary.uploader.upload_stream(
				{
					folder: `${CLOUDINARY_FOLDER}/images`,
					public_id: filename,
					resource_type: 'image',
					type: 'authenticated', // PRIVATE - requires signed URL to access
					overwrite: false,
					invalidate: true,
					// Cloudinary auto-compression settings
					format: 'avif', // Convert to AVIF (best compression)
					quality: 'auto:good', // Auto quality optimization
					fetch_format: 'auto', // Fallback to WebP if AVIF not supported
					flags: 'lossy', // Enable lossy compression
					transformation: [
						{
							quality: 80,
							fetch_format: 'auto'
						}
					]
				},
				async (error, result) => {
					if (error) {
						console.error('Cloudinary upload error:', error);
						reject(new Error('Failed to upload image'));
					} else {
						// Check if file size is still too large after compression
						const fileSizeInMB = result.bytes / (1024 * 1024);

						if (fileSizeInMB > MEDIA_SETTINGS.images.maxSize / (1024 * 1024)) {
							// Delete the file and retry with lower quality
							await deleteMedia(result.public_id, 'image');

							// Retry with aggressive compression
							const retryStream = cloudinary.uploader.upload_stream(
								{
									folder: `${CLOUDINARY_FOLDER}/images`,
									public_id: filename,
									resource_type: 'image',
									type: 'authenticated', // PRIVATE
									overwrite: true,
									invalidate: true,
									format: 'avif',
									quality: 60, // Lower quality
									fetch_format: 'auto',
									flags: 'lossy'
								},
								(retryError, retryResult) => {
									if (retryError) {
										reject(new Error('Failed to compress image to required size'));
									} else {
										resolve({
											url: retryResult.secure_url,
											public_id: retryResult.public_id,
											format: retryResult.format,
											size: retryResult.bytes
										});
									}
								}
							);
							retryStream.end(buffer);
						} else {
							resolve({
								url: result.secure_url,
								public_id: result.public_id,
								format: result.format,
								size: result.bytes
							});
						}
					}
				}
			);

			uploadStream.end(buffer);
		});
	} catch (error) {
		console.error('Upload image error:', error);
		throw error;
	}
}

// Upload GIF to Cloudinary (PRIVATE - no compression)
export async function uploadGif(buffer, userId) {
	try {
		const fileSizeInMB = buffer.length / (1024 * 1024);

		if (fileSizeInMB > MEDIA_SETTINGS.gifs.maxSize / (1024 * 1024)) {
			throw new Error(`GIF size exceeds ${MEDIA_SETTINGS.gifs.maxSize / (1024 * 1024)}MB limit`);
		}

		const filename = `${generateId()}_${userId}`;

		return new Promise((resolve, reject) => {
			const uploadStream = cloudinary.uploader.upload_stream(
				{
					folder: `${CLOUDINARY_FOLDER}/gifs`,
					public_id: filename,
					resource_type: 'image',
					type: 'authenticated', // PRIVATE - requires signed URL to access
					format: 'gif',
					overwrite: false,
					invalidate: true
				},
				(error, result) => {
					if (error) {
						console.error('Cloudinary GIF upload error:', error);
						reject(new Error('Failed to upload GIF'));
					} else {
						resolve({
							url: result.secure_url,
							public_id: result.public_id,
							format: result.format,
							size: result.bytes
						});
					}
				}
			);

			uploadStream.end(buffer);
		});
	} catch (error) {
		console.error('Upload GIF error:', error);
		throw error;
	}
}

// Upload and compress audio to Cloudinary (PRIVATE)
export async function uploadAudio(buffer, userId) {
	try {
		const filename = `${generateId()}_${userId}`;

		return new Promise((resolve, reject) => {
			const uploadStream = cloudinary.uploader.upload_stream(
				{
					folder: `${CLOUDINARY_FOLDER}/audio`,
					public_id: filename,
					resource_type: 'video', // Cloudinary treats audio as video resource
					type: 'authenticated', // PRIVATE - requires signed URL to access
					format: 'mp3',
					audio_codec: 'mp3',
					bit_rate: '64k', // Compress to 64kbps
					audio_frequency: 22050, // 22.05kHz sample rate
					overwrite: false,
					invalidate: true
				},
				async (error, result) => {
					if (error) {
						console.error('Cloudinary audio upload error:', error);
						reject(new Error('Failed to upload audio'));
					} else {
						// Check duration
						const duration = result.duration || 0;

						if (duration > MAX_AUDIO_DURATION_SEC) {
							// Delete from Cloudinary
							await deleteMedia(result.public_id, 'audio');
							reject(new Error(`Audio duration must be ${MAX_AUDIO_DURATION_SEC} seconds or less`));
						} else {
							resolve({
								url: result.secure_url,
								public_id: result.public_id,
								format: result.format,
								size: result.bytes,
								duration: duration
							});
						}
					}
				}
			);

			uploadStream.end(buffer);
		});
	} catch (error) {
		console.error('Upload audio error:', error);
		throw error;
	}
}

// Delete media from Cloudinary
export async function deleteMedia(publicId, mediaType) {
	try {
		const resourceType = mediaType === 'audio' ? 'video' : 'image';

		const result = await cloudinary.uploader.destroy(publicId, {
			resource_type: resourceType,
			type: 'authenticated', // Delete from authenticated/private storage
			invalidate: true
		});

		return result;
	} catch (error) {
		console.error('Delete media error:', error);
		throw new Error('Failed to delete media');
	}
}

// Delete multiple media files
export async function deleteMultipleMedia(publicIds, mediaType) {
	try {
		const resourceType = mediaType === 'audio' ? 'video' : 'image';

		const deletePromises = publicIds.map(publicId =>
			cloudinary.uploader.destroy(publicId, {
				resource_type: resourceType,
				type: 'authenticated', // Delete from authenticated/private storage
				invalidate: true
			})
		);

		const results = await Promise.allSettled(deletePromises);

		return results;
	} catch (error) {
		console.error('Delete multiple media error:', error);
		throw new Error('Failed to delete multiple media');
	}
}
