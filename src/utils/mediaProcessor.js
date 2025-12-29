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
					type: 'authenticated',
					overwrite: false,
					invalidate: true,
					format: 'avif',
					quality: 'auto:good',
					fetch_format: 'auto',
					flags: 'lossy',
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
						const fileSizeInMB = result.bytes / (1024 * 1024);

						if (fileSizeInMB > MEDIA_SETTINGS.images.maxSize / (1024 * 1024)) {
							await deleteMedia(result.public_id, 'image');

							const retryStream = cloudinary.uploader.upload_stream(
								{
									folder: `${CLOUDINARY_FOLDER}/images`,
									public_id: filename,
									resource_type: 'image',
									type: 'authenticated',
									overwrite: true,
									invalidate: true,
									format: 'avif',
									quality: 60,
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

// ✅ WORKING: Upload GIF using direct base64 upload (PRIVATE - authenticated)
export async function uploadGif(buffer, userId) {
	try {
		const filename = `${generateId()}_${userId}`;

		// Convert buffer to base64
		const base64Data = `data:image/gif;base64,${buffer.toString('base64')}`;

		// Use direct upload instead of stream (avoids upload_stream bug with authenticated type)
		const result = await cloudinary.uploader.upload(base64Data, {
			folder: `${CLOUDINARY_FOLDER}/gifs`,
			public_id: filename,
			resource_type: 'image',
			type: 'authenticated',  // ✅ PRIVATE - requires signed URL to access
			format: 'gif',           // ✅ Keep as GIF format (preserves animation)
			overwrite: false,
			invalidate: true
		});

		return {
			url: result.secure_url,
			public_id: result.public_id,
			format: result.format,
			size: result.bytes
		};
	} catch (error) {
		console.error('Upload GIF error:', error);
		throw new Error('Failed to upload GIF');
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
					resource_type: 'video',
					type: 'authenticated',
					format: 'mp3',
					audio_codec: 'mp3',
					bit_rate: '64k',
					audio_frequency: 22050,
					overwrite: false,
					invalidate: true
				},
				async (error, result) => {
					if (error) {
						console.error('Cloudinary audio upload error:', error);
						reject(new Error('Failed to upload audio'));
					} else {
						const duration = result.duration || 0;

						if (duration > MAX_AUDIO_DURATION_SEC) {
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
		let resourceType, deleteType;

		if (mediaType === 'audio') {
			resourceType = 'video';
			deleteType = 'authenticated';
		} else if (mediaType === 'gif') {
			resourceType = 'image';          // GIFs are image resources
			deleteType = 'authenticated';    // GIFs use authenticated type
		} else {
			resourceType = 'image';
			deleteType = 'authenticated';
		}

		const result = await cloudinary.uploader.destroy(publicId, {
			resource_type: resourceType,
			type: deleteType,
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
		let resourceType, deleteType;

		if (mediaType === 'audio') {
			resourceType = 'video';
			deleteType = 'authenticated';
		} else if (mediaType === 'gif') {
			resourceType = 'image';          // GIFs are image resources
			deleteType = 'authenticated';    // GIFs use authenticated type
		} else {
			resourceType = 'image';
			deleteType = 'authenticated';
		}

		const deletePromises = publicIds.map(publicId =>
			cloudinary.uploader.destroy(publicId, {
				resource_type: resourceType,
				type: deleteType,
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
