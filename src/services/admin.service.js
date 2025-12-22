import { db } from '../config/db.js';
import { generateId } from '../utils/idGenerator.js';

// ==================== USER MANAGEMENT ====================

// Get all users
export async function getAllUsers(filters = {}) {
	const { role, isOnline, search } = filters;

	let conditions = [];
	let args = [];

	if (role) {
		conditions.push('role = ?');
		args.push(role);
	}

	if (isOnline !== undefined) {
		conditions.push('is_online = ?');
		args.push(isOnline ? 1 : 0);
	}

	if (search) {
		conditions.push('(username LIKE ? OR email LIKE ? OR name LIKE ?)');
		const searchTerm = `%${search}%`;
		args.push(searchTerm, searchTerm, searchTerm);
	}

	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

	const result = await db.execute({
		sql: `SELECT id, username, email, name, gender, age, role, is_guest, 
		      is_online, created_at, last_login
		      FROM users ${whereClause}
		      ORDER BY created_at DESC`,
		args
	});

	return result.rows;
}

// Get user details with stats
export async function getUserDetails(userId) {
	const userResult = await db.execute({
		sql: `SELECT * FROM users WHERE id = ?`,
		args: [userId]
	});

	if (userResult.rows.length === 0) {
		throw new Error('User not found');
	}

	const user = userResult.rows[0];

	// Get stats
	const chatsResult = await db.execute({
		sql: `SELECT COUNT(*) as total FROM chat_sessions 
		      WHERE (user1_id = ? OR user2_id = ?) AND is_active = 1`,
		args: [userId, userId]
	});

	const messagesResult = await db.execute({
		sql: `SELECT COUNT(*) as total FROM messages WHERE sender_id = ?`,
		args: [userId]
	});

	const roomsResult = await db.execute({
		sql: `SELECT COUNT(*) as total FROM room_members WHERE user_id = ?`,
		args: [userId]
	});

	const friendsResult = await db.execute({
		sql: `SELECT COUNT(*) as total FROM friendships 
		      WHERE (requester_id = ? OR recipient_id = ?) AND status = 'accepted'`,
		args: [userId, userId]
	});

	// Get ban history
	const bansResult = await db.execute({
		sql: `SELECT b.*, u.username as banned_by_name 
		      FROM bans b
		      JOIN users u ON b.banned_by = u.id
		      WHERE b.user_id = ?
		      ORDER BY b.banned_at DESC`,
		args: [userId]
	});

	return {
		user,
		stats: {
			active_chats: chatsResult.rows[0].total,
			messages_sent: messagesResult.rows[0].total,
			rooms_joined: roomsResult.rows[0].total,
			friends: friendsResult.rows[0].total
		},
		ban_history: bansResult.rows
	};
}

// Ban user (moderator: 1 or 3 days, admin: 1, 3 days or permanent)
export async function banUser(userId, bannedBy, durationDays, reason = 'Violation of terms') {
	const now = Date.now();
	const banId = generateId();

	// Get banner's role
	const bannerResult = await db.execute({
		sql: `SELECT role FROM users WHERE id = ?`,
		args: [bannedBy]
	});

	if (bannerResult.rows.length === 0) {
		throw new Error('Banner not found');
	}

	const bannerRole = bannerResult.rows[0].role;

	// Get target user's role
	const targetResult = await db.execute({
		sql: `SELECT role FROM users WHERE id = ?`,
		args: [userId]
	});

	if (targetResult.rows.length === 0) {
		throw new Error('User not found');
	}

	const targetRole = targetResult.rows[0].role;

	// Permission checks
	if (bannerRole === 'moderator') {
		// Moderators can only ban regular users, only 1 or 3 days
		if (targetRole !== 'user' && targetRole !== 'guest') {
			throw new Error('Moderators cannot ban admins or other moderators');
		}
		if (durationDays !== 1 && durationDays !== 3) {
			throw new Error('Moderators can only ban for 1 or 3 days');
		}
	}

	// Calculate expiry
	let expiresAt = null;
	let isPermanent = false;

	if (durationDays === null || durationDays === 0) {
		// Permanent ban (admin only)
		if (bannerRole !== 'admin') {
			throw new Error('Only admins can issue permanent bans');
		}
		isPermanent = true;
	} else {
		expiresAt = now + (durationDays * 24 * 60 * 60 * 1000);
	}

	// Deactivate old bans
	await db.execute({
		sql: `UPDATE bans SET is_active = 0 WHERE user_id = ? AND is_active = 1`,
		args: [userId]
	});

	// Create new ban
	await db.execute({
		sql: `INSERT INTO bans (id, user_id, banned_by, reason, duration_days, banned_at, expires_at, is_permanent, is_active)
		      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
		args: [banId, userId, bannedBy, reason, durationDays, now, expiresAt, isPermanent ? 1 : 0]
	});

	// Update user role to banned
	await db.execute({
		sql: `UPDATE users SET role = 'banned', is_online = 0 WHERE id = ?`,
		args: [userId]
	});

	// Close all active sessions
	await db.execute({
		sql: `UPDATE chat_sessions SET is_active = 0 
		      WHERE (user1_id = ? OR user2_id = ?) AND is_active = 1`,
		args: [userId, userId]
	});

	// Remove from all rooms
	await db.execute({
		sql: `DELETE FROM room_members WHERE user_id = ?`,
		args: [userId]
	});

	return {
		message: 'User banned successfully',
		ban_id: banId,
		duration: isPermanent ? 'permanent' : `${durationDays} days`,
		expires_at: expiresAt
	};
}

// Unban user
export async function unbanUser(userId, unbannedBy) {
	// Get unbanner's role
	const unbannerResult = await db.execute({
		sql: `SELECT role FROM users WHERE id = ?`,
		args: [unbannedBy]
	});

	if (unbannerResult.rows.length === 0) {
		throw new Error('Unbanner not found');
	}

	const unbannerRole = unbannerResult.rows[0].role;

	// Get active ban
	const banResult = await db.execute({
		sql: `SELECT * FROM bans WHERE user_id = ? AND is_active = 1 ORDER BY banned_at DESC LIMIT 1`,
		args: [userId]
	});

	if (banResult.rows.length > 0) {
		const ban = banResult.rows[0];

		// Moderators can only unban their own bans
		if (unbannerRole === 'moderator' && ban.banned_by !== unbannedBy) {
			throw new Error('Moderators can only remove their own bans');
		}
	}

	// Deactivate ban
	await db.execute({
		sql: `UPDATE bans SET is_active = 0 WHERE user_id = ? AND is_active = 1`,
		args: [userId]
	});

	// Update user role back to user
	await db.execute({
		sql: `UPDATE users SET role = 'user' WHERE id = ?`,
		args: [userId]
	});

	return { message: 'User unbanned successfully' };
}

// Delete user (admin only)
export async function deleteUser(userId) {
	await db.execute({
		sql: `DELETE FROM users WHERE id = ?`,
		args: [userId]
	});

	return { message: 'User deleted permanently' };
}

// Promote user (admin only)
export async function promoteUser(userId, newRole) {
	if (!['moderator', 'admin'].includes(newRole)) {
		throw new Error('Invalid role');
	}

	const userResult = await db.execute({
		sql: `SELECT is_guest FROM users WHERE id = ?`,
		args: [userId]
	});

	if (userResult.rows.length === 0) {
		throw new Error('User not found');
	}

	if (userResult.rows[0].is_guest) {
		throw new Error('Cannot promote guest users');
	}

	await db.execute({
		sql: `UPDATE users SET role = ? WHERE id = ?`,
		args: [newRole, userId]
	});

	return { message: `User promoted to ${newRole}` };
}

// Demote user (admin only)
export async function demoteUser(userId) {
	await db.execute({
		sql: `UPDATE users SET role = 'user' WHERE id = ?`,
		args: [userId]
	});

	return { message: 'User demoted to regular user' };
}

// ==================== CHAT MODERATION ====================

// Get all chats
export async function getAllChats() {
	const result = await db.execute({
		sql: `SELECT cs.*, u1.username as user1_name, u2.username as user2_name,
		      (SELECT COUNT(*) FROM messages WHERE session_id = cs.id) as msg_count,
		      (SELECT content FROM messages WHERE session_id = cs.id ORDER BY created_at DESC LIMIT 1) as last_message
		      FROM chat_sessions cs
		      JOIN users u1 ON cs.user1_id = u1.id
		      JOIN users u2 ON cs.user2_id = u2.id
		      ORDER BY cs.created_at DESC`
	});

	return result.rows;
}

// Get chat messages
export async function getChatMessages(sessionId) {
	const result = await db.execute({
		sql: `SELECT m.*, u.username as sender_name
		      FROM messages m
		      JOIN users u ON m.sender_id = u.id
		      WHERE m.session_id = ?
		      ORDER BY m.created_at ASC`,
		args: [sessionId]
	});

	return result.rows;
}

// Delete message
export async function deleteMessage(messageId) {
	await db.execute({
		sql: `DELETE FROM messages WHERE id = ?`,
		args: [messageId]
	});

	return { message: 'Message deleted' };
}

// Delete chat
export async function deleteChat(sessionId) {
	await db.execute({
		sql: `DELETE FROM chat_sessions WHERE id = ?`,
		args: [sessionId]
	});

	return { message: 'Chat deleted' };
}

// ==================== ROOM MANAGEMENT ====================

// Get all rooms
export async function getAllRooms() {
	const result = await db.execute({
		sql: `SELECT r.*, u.username as creator_name,
		      (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as members,
		      (SELECT COUNT(*) FROM room_messages WHERE room_id = r.id) as messages
		      FROM rooms r
		      JOIN users u ON r.creator_id = u.id
		      ORDER BY r.created_at DESC`
	});

	return result.rows;
}

// Get room details
export async function getRoomDetails(roomId) {
	const room = await db.execute({
		sql: `SELECT r.*, u.username as creator_name 
		      FROM rooms r 
		      JOIN users u ON r.creator_id = u.id 
		      WHERE r.id = ?`,
		args: [roomId]
	});

	if (room.rows.length === 0) {
		throw new Error('Room not found');
	}

	const members = await db.execute({
		sql: `SELECT rm.*, u.username, u.is_online 
		      FROM room_members rm 
		      JOIN users u ON rm.user_id = u.id 
		      WHERE rm.room_id = ?`,
		args: [roomId]
	});

	const messages = await db.execute({
		sql: `SELECT rm.*, u.username as sender_name 
		      FROM room_messages rm 
		      JOIN users u ON rm.sender_id = u.id 
		      WHERE rm.room_id = ? 
		      ORDER BY rm.created_at DESC LIMIT 50`,
		args: [roomId]
	});

	return {
		room: room.rows[0],
		members: members.rows,
		recent_messages: messages.rows
	};
}

// Create admin room (admin only)
export async function createAdminRoom(adminId, name, description) {
	const roomId = generateId();
	const now = Date.now();

	await db.execute({
		sql: `INSERT INTO rooms (id, name, description, creator_id, is_admin_room, created_at, is_active)
		      VALUES (?, ?, ?, ?, 1, ?, 1)`,
		args: [roomId, name, description, adminId, now]
	});

	return {
		id: roomId,
		name,
		description,
		is_admin_room: true,
		created_at: now
	};
}

// Update room
export async function updateRoom(roomId, updates) {
	const { name, description } = updates;
	const fields = [];
	const args = [];

	if (name) {
		fields.push('name = ?');
		args.push(name);
	}
	if (description !== undefined) {
		fields.push('description = ?');
		args.push(description);
	}

	if (fields.length === 0) {
		throw new Error('No fields to update');
	}

	args.push(roomId);

	await db.execute({
		sql: `UPDATE rooms SET ${fields.join(', ')} WHERE id = ?`,
		args
	});

	return { message: 'Room updated' };
}

// Delete room
export async function deleteRoom(roomId) {
	await db.execute({
		sql: `DELETE FROM rooms WHERE id = ?`,
		args: [roomId]
	});

	return { message: 'Room deleted' };
}

// Kick user from room
export async function kickUserFromRoom(roomId, userId) {
	await db.execute({
		sql: `DELETE FROM room_members WHERE room_id = ? AND user_id = ?`,
		args: [roomId, userId]
	});

	return { message: 'User kicked from room' };
}

// Delete room message
export async function deleteRoomMessage(messageId) {
	await db.execute({
		sql: `DELETE FROM room_messages WHERE id = ?`,
		args: [messageId]
	});

	return { message: 'Room message deleted' };
}

// ==================== DASHBOARD STATS ====================

// Get dashboard stats
export async function getStats() {
	const users = await db.execute({ sql: `SELECT COUNT(*) as total FROM users` });
	const guests = await db.execute({ sql: `SELECT COUNT(*) as total FROM users WHERE is_guest = 1` });
	const registered = await db.execute({ sql: `SELECT COUNT(*) as total FROM users WHERE is_guest = 0` });
	const onlineUsers = await db.execute({ sql: `SELECT COUNT(*) as total FROM users WHERE is_online = 1` });
	const bannedUsers = await db.execute({ sql: `SELECT COUNT(*) as total FROM users WHERE role = 'banned'` });
	const chats = await db.execute({ sql: `SELECT COUNT(*) as total FROM chat_sessions WHERE is_active = 1` });
	const rooms = await db.execute({ sql: `SELECT COUNT(*) as total FROM rooms WHERE is_active = 1` });
	const messages = await db.execute({ sql: `SELECT COUNT(*) as total FROM messages` });
	const roomMessages = await db.execute({ sql: `SELECT COUNT(*) as total FROM room_messages` });

	// Today's stats
	const todayStart = new Date().setHours(0, 0, 0, 0);
	const newUsersToday = await db.execute({
		sql: `SELECT COUNT(*) as total FROM users WHERE created_at >= ?`,
		args: [todayStart]
	});
	const messagesToday = await db.execute({
		sql: `SELECT COUNT(*) as total FROM messages WHERE created_at >= ?`,
		args: [todayStart]
	});

	return {
		users: {
			total: users.rows[0].total,
			guests: guests.rows[0].total,
			registered: registered.rows[0].total,
			online: onlineUsers.rows[0].total,
			banned: bannedUsers.rows[0].total,
			new_today: newUsersToday.rows[0].total
		},
		chats: {
			active: chats.rows[0].total,
			total_messages: messages.rows[0].total,
			messages_today: messagesToday.rows[0].total
		},
		rooms: {
			active: rooms.rows[0].total,
			total_messages: roomMessages.rows[0].total
		}
	};
}
