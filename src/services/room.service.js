import { db } from '../config/db.js';
import { generateId } from '../utils/idGenerator.js';
import { broadcastRoomMessage, broadcastRoomReaction, broadcastRoomPresence, broadcastRoomReactionRemoval } from './websocket.service.js';



// Create room (admin or registered user)
export async function createRoom(creatorId, name, description, isAdminRoom = false) {
	// Check if creator is guest
	const userResult = await db.execute({
		sql: 'SELECT is_guest, role FROM users WHERE id = ?',
		args: [creatorId]
	});

	if (userResult.rows.length === 0) {
		throw new Error('User not found');
	}

	const user = userResult.rows[0];

	if (user.is_guest) {
		throw new Error('Guest users cannot create rooms');
	}

	// Only admins can create admin rooms
	if (isAdminRoom && user.role !== 'admin') {
		throw new Error('Only admins can create permanent rooms');
	}

	const roomId = generateId();
	const now = Date.now();
	const expiresAt = isAdminRoom ? null : null; // User rooms don't have fixed expiry

	await db.execute({
		sql: `INSERT INTO rooms (id, name, description, creator_id, is_admin_room, created_at, expires_at, is_active)
              VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
		args: [roomId, name, description, creatorId, isAdminRoom ? 1 : 0, now, expiresAt]
	});

	return {
		id: roomId,
		name,
		description,
		creator_id: creatorId,
		is_admin_room: isAdminRoom,
		created_at: now,
		is_active: true
	};
}

// Get all active rooms
export async function getAllRooms() {
	const result = await db.execute({
		sql: `SELECT r.*, 
              u.username as creator_username,
              (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count
              FROM rooms r
              JOIN users u ON r.creator_id = u.id
              WHERE r.is_active = 1
              ORDER BY r.is_admin_room DESC, r.created_at DESC`
	});

	return result.rows;
}

// Get public rooms (no authentication required)
export async function getPublicRooms() {
	const result = await db.execute({
		sql: `SELECT r.id, r.name, r.description, r.is_admin_room, r.created_at,
              u.username as creator_username,
              (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count
              FROM rooms r
              JOIN users u ON r.creator_id = u.id
              WHERE r.is_active = 1
              ORDER BY r.is_admin_room DESC, r.created_at DESC
              LIMIT 20`
	});

	return result.rows;
}

// Get room by ID with timer info
export async function getRoomById(roomId) {
	const result = await db.execute({
		sql: `SELECT r.*, 
              u.username as creator_username,
              u.is_online as creator_online,
              (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count
              FROM rooms r
              JOIN users u ON r.creator_id = u.id
              WHERE r.id = ?`,
		args: [roomId]
	});

	if (result.rows.length === 0) {
		throw new Error('Room not found');
	}

	const room = result.rows[0];

	// Calculate time left if room is expiring
	let timeLeft = null;
	let willExpire = false;

	if (room.expires_at && !room.is_admin_room) {
		const now = Date.now();
		timeLeft = Math.max(0, room.expires_at - now);
		willExpire = timeLeft > 0;
	}

	return {
		...room,
		will_expire: willExpire,
		time_left_ms: timeLeft,
		time_left_minutes: timeLeft ? Math.ceil(timeLeft / (60 * 1000)) : null
	};
}

// Join room
export async function joinRoom(roomId, userId) {
	// Check if room exists and is active
	const room = await getRoomById(roomId);

	if (!room.is_active) {
		throw new Error('Room is not active');
	}

	// Check if user room creator is online (for non-admin rooms)
	if (!room.is_admin_room && !room.creator_online) {
		throw new Error('Room creator is offline. This room will be deleted soon.');
	}

	// Check if already a member
	const existing = await db.execute({
		sql: 'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?',
		args: [roomId, userId]
	});

	if (existing.rows.length > 0) {
		return { message: 'Already in room' };
	}

	const memberId = generateId();
	const now = Date.now();

	await db.execute({
		sql: 'INSERT INTO room_members (id, room_id, user_id, joined_at) VALUES (?, ?, ?, ?)',
		args: [memberId, roomId, userId, now]
	});


	const userResult = await db.execute({
		sql: 'SELECT id, username, gender, is_guest FROM users WHERE id = ?',
		args: [userId]
	});

	if (userResult.rows.length > 0) {
		const user = userResult.rows[0];

		// Broadcast user joined
		try {
			await broadcastRoomPresence(roomId, user, 'joined');
		} catch (wsError) {
			console.error('WebSocket presence broadcast failed:', wsError);
		}
	}

	return { message: 'Joined room successfully' };

}

// Leave room
export async function leaveRoom(roomId, userId) {
	// Get user info for broadcasting BEFORE deleting
	const userResult = await db.execute({
		sql: 'SELECT id, username, gender, is_guest FROM users WHERE id = ?',
		args: [userId]
	});

	// Delete user from room
	await db.execute({
		sql: 'DELETE FROM room_members WHERE room_id = ? AND user_id = ?',
		args: [roomId, userId]
	});

	if (userResult.rows.length > 0) {
		const user = userResult.rows[0];

		// Broadcast user left
		try {
			await broadcastRoomPresence(roomId, user, 'left');
		} catch (wsError) {
			console.error('WebSocket presence broadcast failed:', wsError);
		}
	}

	return { message: 'Left room successfully' };
}

// Send message in room (including secret messages) - UPDATED
export async function sendRoomMessage(
	roomId,
	senderId,
	content,
	type = 'text',
	replyToMessageId = null,
	caption = null,
	recipientId = null
) {
	// Check if user is in room
	const member = await db.execute({
		sql: 'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?',
		args: [roomId, senderId]
	});

	if (member.rows.length === 0) {
		throw new Error('You must join the room to send messages');
	}

	// If recipient specified, set type to 'secret'
	if (recipientId) {
		type = 'secret';
	}

	const messageId = generateId();
	const now = Date.now();

	// UPDATED INSERT with new columns
	await db.execute({
		sql: `INSERT INTO room_messages 
          (id, room_id, sender_id, recipient_id, content, type, created_at, is_read, caption, reply_to_message_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [messageId, roomId, senderId, recipientId, content, type, now, 0, caption, replyToMessageId]
	});

	// Get sender username and gender
	const senderResult = await db.execute({
		sql: 'SELECT username, gender FROM users WHERE id = ?',
		args: [senderId]
	});

	// Get recipient username and gender if secret message
	let recipientUsername = null;
	let recipientGender = null;
	if (recipientId) {
		const recipientResult = await db.execute({
			sql: 'SELECT username, gender FROM users WHERE id = ?',
			args: [recipientId]
		});
		recipientUsername = recipientResult.rows[0]?.username;
		recipientGender = recipientResult.rows[0]?.gender;
	}

	// Get reply message data if reply exists
	let replyData = null;
	if (replyToMessageId) {
		const replyResult = await db.execute({
			sql: `SELECT rm.content, rm.type, rm.caption, rm.created_at, u.username, u.gender
            FROM room_messages rm
            JOIN users u ON rm.sender_id = u.id
            WHERE rm.id = ?`,
			args: [replyToMessageId]
		});
		replyData = replyResult.rows[0];
	}

	try {
		await broadcastRoomMessage(roomId, {
			id: messageId,
			room_id: roomId,
			sender_id: senderId,
			recipient_id: recipientId,
			sender_username: senderResult.rows[0]?.username,
			sender_gender: senderResult.rows[0]?.gender,
			recipient_username: recipientUsername,
			recipient_gender: recipientGender,
			content,
			type,
			caption,
			reply_to_message_id: replyToMessageId,
			...(replyData && {
				reply_to_message_content: replyData.content,
				reply_to_message_sender: replyData.username,
				reply_to_message_gender: replyData.gender,
				reply_to_message_time: replyData.created_at,
				reply_to_message_type: replyData.type,
				reply_to_message_caption: replyData.caption
			}),
			created_at: now
		}, senderId);
	} catch (wsError) {
		console.error('WebSocket broadcast failed:', wsError);
		// Don't fail the message send if WebSocket fails
	}

	return {
		id: messageId,
		room_id: roomId,
		sender_id: senderId,
		recipient_id: recipientId,
		sender_username: senderResult.rows[0]?.username,
		sender_gender: senderResult.rows[0]?.gender,
		recipient_username: recipientUsername,
		recipient_gender: recipientGender,
		content,
		type,
		caption,
		reply_to_message_id: replyToMessageId,
		// Add reply data if exists
		...(replyData && {
			reply_to_message_content: replyData.content,
			reply_to_message_sender: replyData.username,
			reply_to_message_gender: replyData.gender,
			reply_to_message_time: replyData.created_at,
			reply_to_message_type: replyData.type,
			reply_to_message_caption: replyData.caption
		}),
		created_at: now
	};
}

// Get room messages (filter secret messages based on user) - UPDATED with reply data
export async function getRoomMessages(roomId, userId, limit = 100) {
	const result = await db.execute({
		sql: `SELECT rm.*, 
          u1.username as sender_username,
          u1.gender as sender_gender,
          u2.username as recipient_username,
          u2.gender as recipient_gender,
          -- Get reply message data if exists
          rm2.content as reply_to_message_content,
          rm2.type as reply_to_message_type,
          rm2.caption as reply_to_message_caption,
          rm2.created_at as reply_to_message_time,
          u3.username as reply_to_message_sender,
          u3.gender as reply_to_message_gender
          FROM room_messages rm
          JOIN users u1 ON rm.sender_id = u1.id
          LEFT JOIN users u2 ON rm.recipient_id = u2.id
          LEFT JOIN room_messages rm2 ON rm.reply_to_message_id = rm2.id
          LEFT JOIN users u3 ON rm2.sender_id = u3.id
          WHERE rm.room_id = ?
          ORDER BY rm.created_at DESC
          LIMIT ?`,
		args: [roomId, limit]
	});

	// Filter messages - only show secret messages to sender and recipient
	const filteredMessages = result.rows.filter(msg => {
		if (msg.type === 'secret') {
			return msg.sender_id === userId || msg.recipient_id === userId;
		}
		return true;
	});

	return filteredMessages.reverse();
}

// Get room members
export async function getRoomMembers(roomId) {
	const result = await db.execute({
		sql: `SELECT rm.*, u.username, u.gender, u.is_online, u.is_guest
              FROM room_members rm
              JOIN users u ON rm.user_id = u.id
              WHERE rm.room_id = ?
              ORDER BY rm.joined_at DESC`,
		args: [roomId]
	});

	return result.rows;
}

// Delete room (admin or creator only)
export async function deleteRoom(roomId, userId) {
	const room = await getRoomById(roomId);

	// Check if user has permission to delete
	const userResult = await db.execute({
		sql: 'SELECT role FROM users WHERE id = ?',
		args: [userId]
	});

	const isAdmin = userResult.rows[0]?.role === 'admin';
	const isCreator = room.creator_id === userId;

	if (!isAdmin && !isCreator) {
		throw new Error('Only room creator or admin can delete this room');
	}

	await db.execute({
		sql: 'DELETE FROM rooms WHERE id = ?',
		args: [roomId]
	});

	return { message: 'Room deleted successfully' };
}

// Mark user room for deletion when creator logs out
export async function markUserRoomsForDeletion(userId) {
	const now = Date.now();
	const tenMinutesLater = now + (10 * 60 * 1000); // 10 minutes from now

	await db.execute({
		sql: `UPDATE rooms 
              SET expires_at = ? 
              WHERE creator_id = ? AND is_admin_room = 0`,
		args: [tenMinutesLater, userId]
	});

	// Send system message to all user's rooms
	const userRooms = await db.execute({
		sql: 'SELECT id FROM rooms WHERE creator_id = ? AND is_admin_room = 0',
		args: [userId]
	});

	for (const room of userRooms.rows) {
		const messageId = generateId();
		await db.execute({
			sql: `INSERT INTO room_messages (id, room_id, sender_id, content, type, created_at)
                  VALUES (?, ?, ?, ?, 'system', ?)`,
			args: [
				messageId,
				room.id,
				userId,
				'⚠️ Room creator has left. This room will be deleted in 10 minutes.',
				now
			]
		});
	}

	return { message: 'User rooms marked for deletion' };
}

// Delete expired rooms
export async function deleteExpiredRooms() {
	const now = Date.now();

	await db.execute({
		sql: 'DELETE FROM rooms WHERE expires_at IS NOT NULL AND expires_at < ?',
		args: [now]
	});

	return { message: 'Expired rooms deleted' };
}

export async function reactToRoomMessage(messageId, userId, emoji) {
	// Check if user has access to the message
	const messageCheck = await db.execute({
		sql: `SELECT rm.room_id, rm.sender_id, rm.recipient_id, rm.type
          FROM room_messages rm
          WHERE rm.id = ?`,
		args: [messageId]
	});

	if (messageCheck.rows.length === 0) {
		throw new Error('Message not found');
	}

	const message = messageCheck.rows[0];

	// Check if user is in the room
	const memberCheck = await db.execute({
		sql: 'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?',
		args: [message.room_id, userId]
	});

	if (memberCheck.rows.length === 0) {
		throw new Error('You must be in the room to react to messages');
	}

	// Check if user can see this message (for secret messages)
	if (message.type === 'secret') {
		if (message.sender_id !== userId && message.recipient_id !== userId) {
			throw new Error('You cannot react to this message');
		}
	}

	const reactionId = generateId();
	const now = Date.now();

	await db.execute({
		sql: `INSERT INTO room_message_reactions (id, message_id, user_id, emoji, created_at)
          VALUES (?, ?, ?, ?, ?)`,
		args: [reactionId, messageId, userId, emoji, now]
	});

	// Get user info for the reaction
	const userResult = await db.execute({
		sql: 'SELECT username, gender FROM users WHERE id = ?',
		args: [userId]
	});

	try {
		await broadcastRoomReaction(message.room_id, {
			id: reactionId,
			message_id: messageId,
			user_id: userId,
			username: userResult.rows[0]?.username,
			gender: userResult.rows[0]?.gender,
			emoji,
			created_at: now
		}, messageId);
	} catch (wsError) {
		console.error('WebSocket reaction broadcast failed:', wsError);
	}

	return {
		id: reactionId,
		message_id: messageId,
		user_id: userId,
		username: userResult.rows[0]?.username,
		gender: userResult.rows[0]?.gender,
		emoji,
		created_at: now
	};
}

// Get reactions for room message - NEW FUNCTION
export async function getRoomMessageReactions(messageId) {
	const result = await db.execute({
		sql: `SELECT rmr.*, u.username, u.gender
          FROM room_message_reactions rmr
          JOIN users u ON rmr.user_id = u.id
          WHERE rmr.message_id = ?
          ORDER BY rmr.created_at DESC`,
		args: [messageId]
	});

	return result.rows;
}

// Remove reaction from room message - UPDATED
export async function removeRoomMessageReaction(reactionId, userId) {
	// First get reaction details to find room_id and message_id
	const reactionCheck = await db.execute({
		sql: `SELECT rmr.message_id, rm.room_id 
          FROM room_message_reactions rmr
          JOIN room_messages rm ON rmr.message_id = rm.id
          WHERE rmr.id = ? AND rmr.user_id = ?`,
		args: [reactionId, userId]
	});

	if (reactionCheck.rows.length === 0) {
		throw new Error('Reaction not found or you do not have permission to remove it');
	}

	const { message_id, room_id } = reactionCheck.rows[0];

	// Delete the reaction
	await db.execute({
		sql: `DELETE FROM room_message_reactions 
          WHERE id = ? AND user_id = ?`,
		args: [reactionId, userId]
	});

	// Broadcast removal
	try {
		await broadcastRoomReactionRemoval(room_id, reactionId, message_id);
	} catch (wsError) {
		console.error('WebSocket removal broadcast failed:', wsError);
	}

	return { message: 'Reaction removed' };
}
