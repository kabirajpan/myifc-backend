import { db } from '../config/db.js';
import { generateId } from '../utils/idGenerator.js';

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

	return { message: 'Joined room successfully' };
}

// Leave room
export async function leaveRoom(roomId, userId) {
	await db.execute({
		sql: 'DELETE FROM room_members WHERE room_id = ? AND user_id = ?',
		args: [roomId, userId]
	});

	return { message: 'Left room successfully' };
}

// Send message in room (including secret messages)
export async function sendRoomMessage(roomId, senderId, content, type = 'text', recipientId = null) {
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

	await db.execute({
		sql: `INSERT INTO room_messages (id, room_id, sender_id, recipient_id, content, type, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
		args: [messageId, roomId, senderId, recipientId, content, type, now]
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
		created_at: now
	};
}

// Get room messages (filter secret messages based on user)
export async function getRoomMessages(roomId, userId, limit = 100) {
	const result = await db.execute({
		sql: `SELECT rm.*, 
              u1.username as sender_username,
              u1.gender as sender_gender,
              u2.username as recipient_username,
              u2.gender as recipient_gender
              FROM room_messages rm
              JOIN users u1 ON rm.sender_id = u1.id
              LEFT JOIN users u2 ON rm.recipient_id = u2.id
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
