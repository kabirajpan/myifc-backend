import { db } from '../config/db.js';
import { generateId } from '../utils/idGenerator.js';
import {
	broadcastNewMessage,
	broadcastChatReaction,
	broadcastChatReactionRemoval
} from './websocket.service.js';
import { extractPublicIdFromUrl, isPublicId } from './media.service.js';
import { deleteMedia, deleteMultipleMedia } from '../utils/mediaProcessor.js';
import { sendToUser } from './websocket.service.js';

// Create or get existing chat session
export async function createOrGetChatSession(user1_id, user2_id) {
	// Check if other user is online
	const otherUserResult = await db.execute({
		sql: 'SELECT is_online FROM users WHERE id = ?',
		args: [user2_id]
	});

	if (otherUserResult.rows.length === 0) {
		throw new Error('User not found');
	}

	if (!otherUserResult.rows[0].is_online) {
		throw new Error('User is offline. Cannot send message.');
	}

	// Sort user IDs to maintain consistency (always store smaller ID as user1)
	const [userId1, userId2] = [user1_id, user2_id].sort();

	// Check if session already exists
	const existing = await db.execute({
		sql: `SELECT * FROM chat_sessions 
              WHERE user1_id = ? AND user2_id = ? AND is_active = 1`,
		args: [userId1, userId2]
	});

	if (existing.rows.length > 0) {
		return existing.rows[0];
	}

	// Create new session
	const sessionId = generateId();
	const now = Date.now();
	const expiresAt = now + (24 * 60 * 60 * 1000); // 24 hours from now

	await db.execute({
		sql: `INSERT INTO chat_sessions (id, user1_id, user2_id, created_at, expires_at, is_active)
              VALUES (?, ?, ?, ?, ?, 1)`,
		args: [sessionId, userId1, userId2, now, expiresAt]
	});

	return {
		id: sessionId,
		user1_id: userId1,
		user2_id: userId2,
		created_at: now,
		expires_at: expiresAt,
		user1_logged_out: 0,
		user2_logged_out: 0,
		is_active: 1
	};
}

// Send a message
export async function sendMessage(session_id, sender_id, content, type = 'text', reply_to_message_id = null, caption = null) {
	const messageId = generateId();
	const now = Date.now();

	// Get session to determine user positions
	const sessionResult = await db.execute({
		sql: 'SELECT * FROM chat_sessions WHERE id = ? AND is_active = 1',
		args: [session_id]
	});

	if (sessionResult.rows.length === 0) {
		throw new Error('Chat session not found or expired');
	}

	const session = sessionResult.rows[0];

	// Determine which user is sending (user1 or user2)
	const isUser1 = session.user1_id === sender_id;
	const isUser2 = session.user2_id === sender_id;

	if (!isUser1 && !isUser2) {
		throw new Error('Sender is not part of this chat session');
	}

	// Check if other user is online
	const otherUserId = isUser1 ? session.user2_id : session.user1_id;
	const otherUserResult = await db.execute({
		sql: 'SELECT is_online FROM users WHERE id = ?',
		args: [otherUserId]
	});

	if (otherUserResult.rows.length === 0 || !otherUserResult.rows[0].is_online) {
		throw new Error('User is offline. Cannot send message.');
	}

	// Check if the other user has logged out
	const visibleToUser1 = isUser1 ? true : !session.user1_logged_out;
	const visibleToUser2 = isUser2 ? true : !session.user2_logged_out;

	// For media messages, store public_id or URL (now using public URLs)
	let contentToStore = content;
	if (['image', 'gif', 'audio'].includes(type)) {
		// If content is a URL, extract public_id for storage
		if (!isPublicId(content)) {
			contentToStore = extractPublicIdFromUrl(content);
		}
	}

	// INSERT with caption support
	await db.execute({
		sql: `INSERT INTO messages (id, session_id, sender_id, content, type, caption, created_at, visible_to_user1, visible_to_user2, reply_to_message_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [messageId, session_id, sender_id, contentToStore, type, caption, now, visibleToUser1 ? 1 : 0, visibleToUser2 ? 1 : 0, reply_to_message_id]
	});

	// Reset logout flags when new message is sent (reactivate chat)
	if (isUser1 && session.user1_logged_out) {
		await db.execute({
			sql: 'UPDATE chat_sessions SET user1_logged_out = 0 WHERE id = ?',
			args: [session_id]
		});
	}
	if (isUser2 && session.user2_logged_out) {
		await db.execute({
			sql: 'UPDATE chat_sessions SET user2_logged_out = 0 WHERE id = ?',
			args: [session_id]
		});
	}

	// Get sender username and gender for WebSocket broadcast
	const senderResult = await db.execute({
		sql: 'SELECT username, gender FROM users WHERE id = ?',
		args: [sender_id]
	});
	const senderUsername = senderResult.rows[0]?.username || 'Unknown';
	const senderGender = senderResult.rows[0]?.gender || null;

	// Content is already a public URL or public_id
	let displayContent = contentToStore;

	// Fetch reply message details if replying
	let replyDetails = null;
	if (reply_to_message_id) {
		const replyResult = await db.execute({
			sql: `SELECT m.content, m.type, m.created_at, m.caption, u.username, u.gender 
          FROM messages m
          JOIN users u ON m.sender_id = u.id
          WHERE m.id = ?`,
			args: [reply_to_message_id]
		});

		if (replyResult.rows.length > 0) {
			const reply = replyResult.rows[0];

			// Content is already a public URL or public_id
			let replyContent = reply.content;

			replyDetails = {
				reply_to_message_content: replyContent,
				reply_to_message_sender: reply.username,
				reply_to_message_gender: reply.gender,
				reply_to_message_time: reply.created_at,
				reply_to_message_type: reply.type,
				reply_to_message_caption: reply.caption || null
			};
		}
	}

	const messageData = {
		id: messageId,
		session_id,
		sender_id,
		sender_username: senderUsername,
		sender_gender: senderGender,
		content: displayContent,
		type,
		caption: caption,
		created_at: now,
		is_read: false,
		reply_to_message_id: reply_to_message_id,
		...(replyDetails || {})
	};

	// Broadcast to other user via WebSocket
	broadcastNewMessage(session, messageData, senderUsername);

	return messageData;
}

// Delete a message (media only)
export async function deleteMessage(message_id, user_id) {
	try {
		// Get message details
		const messageResult = await db.execute({
			sql: 'SELECT * FROM messages WHERE id = ?',
			args: [message_id]
		});

		if (messageResult.rows.length === 0) {
			throw new Error('Message not found');
		}

		const message = messageResult.rows[0];

		// Check if user is the sender
		if (message.sender_id !== user_id) {
			throw new Error('You can only delete your own messages');
		}

		// Check if message is media type
		if (!['image', 'gif', 'audio'].includes(message.type)) {
			throw new Error('Only media messages can be deleted');
		}

		// Content is stored as public_id
		const publicId = message.content;

		// Delete from Cloudinary
		await deleteMedia(publicId, message.type);

		// Delete from database
		await db.execute({
			sql: 'DELETE FROM messages WHERE id = ?',
			args: [message_id]
		});

		return { message: 'Message deleted successfully' };
	} catch (error) {
		console.error('Delete message error:', error);
		throw error;
	}
}

// Get messages for a specific user in a chat session
export async function getMessages(session_id, user_id) {
	// Get session to determine which user is requesting
	const sessionResult = await db.execute({
		sql: 'SELECT * FROM chat_sessions WHERE id = ? AND is_active = 1',
		args: [session_id]
	});

	if (sessionResult.rows.length === 0) {
		throw new Error('Chat session not found');
	}

	const session = sessionResult.rows[0];
	const isUser1 = session.user1_id === user_id;
	const isUser2 = session.user2_id === user_id;

	if (!isUser1 && !isUser2) {
		throw new Error('User is not part of this chat session');
	}

	// Get messages visible to this user
	const visibilityField = isUser1 ? 'visible_to_user1' : 'visible_to_user2';

	const result = await db.execute({
		sql: `SELECT 
			  m.*, 
			  u.username as sender_username, 
			  u.gender as sender_gender,
			  reply_msg.content as reply_to_message_content,
			  reply_msg.type as reply_to_message_type,
			  reply_msg.caption as reply_to_message_caption,
			  reply_user.username as reply_to_message_sender,
			  reply_user.gender as reply_to_message_gender,
			  reply_msg.created_at as reply_to_message_time
			  FROM messages m
			  JOIN users u ON m.sender_id = u.id
			  LEFT JOIN messages reply_msg ON m.reply_to_message_id = reply_msg.id
			  LEFT JOIN users reply_user ON reply_msg.sender_id = reply_user.id
			  WHERE m.session_id = ? AND m.${visibilityField} = 1
			  ORDER BY m.created_at ASC`,
		args: [session_id]
	});

	// ✅ NEW: Fetch reactions for all messages (batch query like room chat)
	const messageIds = result.rows.map(m => m.id);
	let allReactions = [];

	if (messageIds.length > 0) {
		const placeholders = messageIds.map(() => '?').join(',');
		const reactionsResult = await db.execute({
			sql: `SELECT mr.*, u.username, u.gender
			      FROM message_reactions mr
			      JOIN users u ON mr.user_id = u.id
			      WHERE mr.message_id IN (${placeholders})
			      ORDER BY mr.created_at ASC`,
			args: messageIds
		});
		allReactions = reactionsResult.rows || [];
		console.log(`✅ Fetched ${allReactions.length} reactions in 1 query for ${messageIds.length} messages`);
	}

	// Group reactions by message_id
	const reactionsByMessage = {};
	allReactions.forEach(reaction => {
		if (!reactionsByMessage[reaction.message_id]) {
			reactionsByMessage[reaction.message_id] = [];
		}
		reactionsByMessage[reaction.message_id].push(reaction);
	});

	// ✅ Attach reactions to messages
	const messagesWithReactions = result.rows.map(msg => ({
		...msg,
		reactions: reactionsByMessage[msg.id] || []
	}));

	return messagesWithReactions;
}

// Get all active chat sessions for a user
export async function getUserChats(user_id) {
	const result = await db.execute({
		sql: `SELECT cs.*, 
              u1.username as user1_username,
              u1.gender as user1_gender,
              u2.username as user2_username,
              u2.gender as user2_gender,
              u1.is_online as user1_online,
              u2.is_online as user2_online,
              (SELECT content FROM messages WHERE session_id = cs.id ORDER BY created_at DESC LIMIT 1) as last_message,
              (SELECT type FROM messages WHERE session_id = cs.id ORDER BY created_at DESC LIMIT 1) as last_message_type,
              (SELECT created_at FROM messages WHERE session_id = cs.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
              (SELECT COUNT(*) FROM messages WHERE session_id = cs.id AND is_read = 0 AND sender_id != ?) as unread_count
              FROM chat_sessions cs
              JOIN users u1 ON cs.user1_id = u1.id
              JOIN users u2 ON cs.user2_id = u2.id
              WHERE (cs.user1_id = ? OR cs.user2_id = ?) AND cs.is_active = 1
              ORDER BY last_message_time DESC`,
		args: [user_id, user_id, user_id]
	});

	// Format the response to show the "other" user's info
	return result.rows.map(chat => {
		const isUser1 = chat.user1_id === user_id;

		// Format last message preview for media
		let lastMessage = chat.last_message;
		if (chat.last_message && ['image', 'gif', 'audio'].includes(chat.last_message_type)) {
			// Show clean media type label
			if (chat.last_message_type === 'image') {
				lastMessage = 'Image';
			} else if (chat.last_message_type === 'gif') {
				lastMessage = 'GIF';
			} else if (chat.last_message_type === 'audio') {
				lastMessage = 'Voice message';
			}
		}

		return {
			session_id: chat.id,
			other_user_id: isUser1 ? chat.user2_id : chat.user1_id,
			other_user_name: isUser1 ? chat.user2_username : chat.user1_username,
			other_user_gender: isUser1 ? chat.user2_gender : chat.user1_gender,
			other_user_online: isUser1 ? chat.user2_online : chat.user1_online,
			last_message: lastMessage,
			last_message_type: chat.last_message_type,
			last_message_time: chat.last_message_time,
			unread_count: chat.unread_count,
			created_at: chat.created_at
		};
	});
}

// Mark messages as read
export async function markMessagesAsRead(session_id, user_id) {
	// First, get the messages that will be marked as read
	const unreadMessages = await db.execute({
		sql: `SELECT id, sender_id FROM messages 
              WHERE session_id = ? AND sender_id != ? AND is_read = 0`,
		args: [session_id, user_id]
	});

	// Mark them as read in database
	await db.execute({
		sql: `UPDATE messages 
              SET is_read = 1 
              WHERE session_id = ? AND sender_id != ? AND is_read = 0`,
		args: [session_id, user_id]
	});

	// Broadcast read receipt to each sender via WebSocket
	for (const msg of unreadMessages.rows) {
		sendToUser(msg.sender_id, {
			type: 'message_read',
			message_id: msg.id,
			session_id: session_id
		});
	}

	return { message: 'Messages marked as read' };
}

// ✅ NEW: React to P2P message
export async function reactToMessage(messageId, userId, emoji) {
	// Check if message exists and user has access
	const messageCheck = await db.execute({
		sql: `SELECT m.session_id, m.sender_id, cs.user1_id, cs.user2_id
		      FROM messages m
		      JOIN chat_sessions cs ON m.session_id = cs.id
		      WHERE m.id = ? AND cs.is_active = 1`,
		args: [messageId]
	});

	if (messageCheck.rows.length === 0) {
		throw new Error('Message not found');
	}

	const message = messageCheck.rows[0];

	// Check if user is part of the chat session
	if (message.user1_id !== userId && message.user2_id !== userId) {
		throw new Error('You are not part of this chat session');
	}

	const reactionId = generateId();
	const now = Date.now();

	await db.execute({
		sql: `INSERT INTO message_reactions (id, message_id, user_id, emoji, created_at)
		      VALUES (?, ?, ?, ?, ?)`,
		args: [reactionId, messageId, userId, emoji, now]
	});

	// Get user info for the reaction
	const userResult = await db.execute({
		sql: 'SELECT username, gender FROM users WHERE id = ?',
		args: [userId]
	});

	const reaction = {
		id: reactionId,
		message_id: messageId,
		user_id: userId,
		username: userResult.rows[0]?.username,
		gender: userResult.rows[0]?.gender,
		emoji,
		created_at: now
	};

	// Broadcast reaction via WebSocket
	try {
		await broadcastChatReaction(message.session_id, reaction, messageId);
	} catch (wsError) {
		console.error('WebSocket reaction broadcast failed:', wsError);
	}

	return reaction;
}

// ✅ NEW: Remove reaction from P2P message
export async function removeMessageReaction(reactionId, userId) {
	// Get reaction details to find session_id and message_id
	const reactionCheck = await db.execute({
		sql: `SELECT mr.message_id, m.session_id 
		      FROM message_reactions mr
		      JOIN messages m ON mr.message_id = m.id
		      WHERE mr.id = ? AND mr.user_id = ?`,
		args: [reactionId, userId]
	});

	if (reactionCheck.rows.length === 0) {
		throw new Error('Reaction not found or you do not have permission to remove it');
	}

	const { message_id, session_id } = reactionCheck.rows[0];

	// Delete the reaction
	await db.execute({
		sql: `DELETE FROM message_reactions 
		      WHERE id = ? AND user_id = ?`,
		args: [reactionId, userId]
	});

	// Broadcast removal via WebSocket
	try {
		await broadcastChatReactionRemoval(session_id, reactionId, message_id, userId);
	} catch (wsError) {
		console.error('WebSocket removal broadcast failed:', wsError);
	}

	return { message: 'Reaction removed' };
}

// ✅ NEW: Get reactions for a P2P message
export async function getMessageReactions(messageId) {
	const result = await db.execute({
		sql: `SELECT mr.*, u.username, u.gender
		      FROM message_reactions mr
		      JOIN users u ON mr.user_id = u.id
		      WHERE mr.message_id = ?
		      ORDER BY mr.created_at DESC`,
		args: [messageId]
	});

	return result.rows;
}

// Handle user logout - hide messages from user's view + delete media
export async function handleUserLogout(user_id) {
	// Get all active sessions for this user
	const sessions = await db.execute({
		sql: `SELECT * FROM chat_sessions 
              WHERE (user1_id = ? OR user2_id = ?) AND is_active = 1`,
		args: [user_id, user_id]
	});

	for (const session of sessions.rows) {
		const isUser1 = session.user1_id === user_id;
		const visibilityField = isUser1 ? 'visible_to_user1' : 'visible_to_user2';

		// Get all media messages in this session that are visible to this user
		const mediaMessages = await db.execute({
			sql: `SELECT id, content, type FROM messages 
                  WHERE session_id = ? AND ${visibilityField} = 1 
                  AND type IN ('image', 'gif', 'audio')`,
			args: [session.id]
		});

		// Hide all messages in this session from this user
		await db.execute({
			sql: `UPDATE messages 
                  SET ${visibilityField} = 0 
                  WHERE session_id = ?`,
			args: [session.id]
		});

		// Check if both users have logged out
		const otherUserLoggedOut = isUser1 ? session.user2_logged_out : session.user1_logged_out;

		if (otherUserLoggedOut) {
			// Both logged out - delete media from Cloudinary
			if (mediaMessages.rows.length > 0) {
				// Group by media type
				const imageIds = [];
				const audioIds = [];

				mediaMessages.rows.forEach(msg => {
					// Content is stored as public_id
					const publicId = msg.content;
					if (msg.type === 'audio') {
						audioIds.push(publicId);
					} else {
						imageIds.push(publicId);
					}
				});

				// Delete from Cloudinary
				if (imageIds.length > 0) {
					await deleteMultipleMedia(imageIds, 'image');
				}
				if (audioIds.length > 0) {
					await deleteMultipleMedia(audioIds, 'audio');
				}
			}

			// Delete the entire session
			await db.execute({
				sql: 'DELETE FROM chat_sessions WHERE id = ?',
				args: [session.id]
			});
		}
	}
}

// Cleanup old chats (24+ hours) + delete media
export async function cleanupOldChats() {
	const now = Date.now();
	const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);

	// Get all old media messages before deleting
	const oldMediaMessages = await db.execute({
		sql: `SELECT id, content, type FROM messages 
              WHERE created_at < ? AND type IN ('image', 'gif', 'audio')`,
		args: [twentyFourHoursAgo]
	});

	// Delete media from Cloudinary
	if (oldMediaMessages.rows.length > 0) {
		const imageIds = [];
		const audioIds = [];

		oldMediaMessages.rows.forEach(msg => {
			// Content is stored as public_id
			const publicId = msg.content;
			if (msg.type === 'audio') {
				audioIds.push(publicId);
			} else {
				imageIds.push(publicId);
			}
		});

		// Delete from Cloudinary
		if (imageIds.length > 0) {
			await deleteMultipleMedia(imageIds, 'image');
		}
		if (audioIds.length > 0) {
			await deleteMultipleMedia(audioIds, 'audio');
		}
	}

	// Delete messages older than 24 hours
	await db.execute({
		sql: 'DELETE FROM messages WHERE created_at < ?',
		args: [twentyFourHoursAgo]
	});

	// Delete expired sessions
	await db.execute({
		sql: 'DELETE FROM chat_sessions WHERE expires_at < ?',
		args: [now]
	});

	return {
		message: 'Old chats cleaned up',
		deleted_messages: oldMediaMessages.rows.length
	};
}

// Get chat session details
export async function getChatSession(session_id) {
	const result = await db.execute({
		sql: `SELECT cs.*, 
              u1.username as user1_username,
              u1.gender as user1_gender,
              u2.username as user2_username,
              u2.gender as user2_gender,
              u1.is_online as user1_online,
              u2.is_online as user2_online
              FROM chat_sessions cs
              JOIN users u1 ON cs.user1_id = u1.id
              JOIN users u2 ON cs.user2_id = u2.id
              WHERE cs.id = ?`,
		args: [session_id]
	});

	if (result.rows.length === 0) {
		throw new Error('Chat session not found');
	}

	return result.rows[0];
}
