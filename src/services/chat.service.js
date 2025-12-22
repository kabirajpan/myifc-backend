import { db } from '../config/db.js';
import { generateId } from '../utils/idGenerator.js';
import { broadcastNewMessage } from './websocket.service.js';

// Create or get existing chat session
export async function createOrGetChatSession(user1_id, user2_id) {
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
export async function sendMessage(session_id, sender_id, content, type = 'text') {
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

	// Check if the other user has logged out
	// If user1 is sending and user2 logged out, message should only be visible to user1
	// If user2 is sending and user1 logged out, message should only be visible to user2
	const visibleToUser1 = isUser1 ? true : !session.user1_logged_out;
	const visibleToUser2 = isUser2 ? true : !session.user2_logged_out;

	await db.execute({
		sql: `INSERT INTO messages (id, session_id, sender_id, content, type, created_at, visible_to_user1, visible_to_user2)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [messageId, session_id, sender_id, content, type, now, visibleToUser1 ? 1 : 0, visibleToUser2 ? 1 : 0]
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

	// Get sender username for WebSocket broadcast
	const senderResult = await db.execute({
		sql: 'SELECT username FROM users WHERE id = ?',
		args: [sender_id]
	});
	const senderUsername = senderResult.rows[0]?.username || 'Unknown';

	const messageData = {
		id: messageId,
		session_id,
		sender_id,
		content,
		type,
		created_at: now,
		is_read: false
	};

	// Broadcast to other user via WebSocket
	broadcastNewMessage(session, messageData, senderUsername);

	return messageData;
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
		sql: `SELECT m.*, u.username as sender_username
              FROM messages m
              JOIN users u ON m.sender_id = u.id
              WHERE m.session_id = ? AND m.${visibilityField} = 1
              ORDER BY m.created_at ASC`,
		args: [session_id]
	});

	return result.rows;
}

// Get all active chat sessions for a user
export async function getUserChats(user_id) {
	const result = await db.execute({
		sql: `SELECT cs.*, 
              u1.username as user1_username,
              u2.username as user2_username,
              u1.is_online as user1_online,
              u2.is_online as user2_online,
              (SELECT content FROM messages WHERE session_id = cs.id ORDER BY created_at DESC LIMIT 1) as last_message,
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
		return {
			session_id: chat.id,
			other_user_id: isUser1 ? chat.user2_id : chat.user1_id,
			other_user_name: isUser1 ? chat.user2_username : chat.user1_username,
			other_user_online: isUser1 ? chat.user2_online : chat.user1_online,
			last_message: chat.last_message,
			last_message_time: chat.last_message_time,
			unread_count: chat.unread_count,
			created_at: chat.created_at
		};
	});
}

// Mark messages as read
export async function markMessagesAsRead(session_id, user_id) {
	await db.execute({
		sql: `UPDATE messages 
              SET is_read = 1 
              WHERE session_id = ? AND sender_id != ? AND is_read = 0`,
		args: [session_id, user_id]
	});

	return { message: 'Messages marked as read' };
}

// Handle user logout - hide messages from user's view
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
			// Both logged out - delete the entire session
			await db.execute({
				sql: 'DELETE FROM chat_sessions WHERE id = ?',
				args: [session.id]
			});
		}
	}
}

// Cleanup old chats (24+ hours)
export async function cleanupOldChats() {
	const now = Date.now();
	const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);

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

	return { message: 'Old chats cleaned up' };
}

// Get chat session details
export async function getChatSession(session_id) {
	const result = await db.execute({
		sql: `SELECT cs.*, 
              u1.username as user1_username,
              u2.username as user2_username,
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
