import { db } from '../config/db.js';
import { generateId } from '../utils/idGenerator.js';

// Send friend request
export async function sendFriendRequest(requesterId, recipientId) {
	// Check if users are guests
	const requesterResult = await db.execute({
		sql: 'SELECT is_guest FROM users WHERE id = ?',
		args: [requesterId]
	});

	const recipientResult = await db.execute({
		sql: 'SELECT is_guest FROM users WHERE id = ?',
		args: [recipientId]
	});

	if (requesterResult.rows[0]?.is_guest || recipientResult.rows[0]?.is_guest) {
		throw new Error('Guest users cannot send or receive friend requests');
	}

	// Check if request already exists
	const existing = await db.execute({
		sql: `SELECT * FROM friendships 
              WHERE (requester_id = ? AND recipient_id = ?) 
              OR (requester_id = ? AND recipient_id = ?)`,
		args: [requesterId, recipientId, recipientId, requesterId]
	});

	if (existing.rows.length > 0) {
		throw new Error('Friend request already exists');
	}

	const friendshipId = generateId();
	const now = Date.now();

	await db.execute({
		sql: `INSERT INTO friendships (id, requester_id, recipient_id, status, created_at)
              VALUES (?, ?, ?, 'pending', ?)`,
		args: [friendshipId, requesterId, recipientId, now]
	});

	return {
		id: friendshipId,
		requester_id: requesterId,
		recipient_id: recipientId,
		status: 'pending',
		created_at: now
	};
}

// Accept friend request
export async function acceptFriendRequest(userId, friendshipId) {
	const now = Date.now();

	// Verify user is the recipient
	const friendship = await db.execute({
		sql: 'SELECT * FROM friendships WHERE id = ? AND recipient_id = ?',
		args: [friendshipId, userId]
	});

	if (friendship.rows.length === 0) {
		throw new Error('Friend request not found');
	}

	if (friendship.rows[0].status !== 'pending') {
		throw new Error('Friend request is not pending');
	}

	await db.execute({
		sql: `UPDATE friendships 
              SET status = 'accepted', updated_at = ? 
              WHERE id = ?`,
		args: [now, friendshipId]
	});

	return { message: 'Friend request accepted' };
}

// Reject friend request
export async function rejectFriendRequest(userId, friendshipId) {
	const now = Date.now();

	// Verify user is the recipient
	const friendship = await db.execute({
		sql: 'SELECT * FROM friendships WHERE id = ? AND recipient_id = ?',
		args: [friendshipId, userId]
	});

	if (friendship.rows.length === 0) {
		throw new Error('Friend request not found');
	}

	await db.execute({
		sql: `UPDATE friendships 
              SET status = 'rejected', updated_at = ? 
              WHERE id = ?`,
		args: [now, friendshipId]
	});

	return { message: 'Friend request rejected' };
}

// Block user
export async function blockUser(userId, targetUserId) {
	const now = Date.now();

	// Check if friendship exists
	const existing = await db.execute({
		sql: `SELECT * FROM friendships 
              WHERE (requester_id = ? AND recipient_id = ?) 
              OR (requester_id = ? AND recipient_id = ?)`,
		args: [userId, targetUserId, targetUserId, userId]
	});

	if (existing.rows.length > 0) {
		// Update existing friendship to blocked
		await db.execute({
			sql: `UPDATE friendships 
                  SET status = 'blocked', updated_at = ? 
                  WHERE id = ?`,
			args: [now, existing.rows[0].id]
		});
	} else {
		// Create new blocked entry
		const friendshipId = generateId();
		await db.execute({
			sql: `INSERT INTO friendships (id, requester_id, recipient_id, status, created_at)
                  VALUES (?, ?, ?, 'blocked', ?)`,
			args: [friendshipId, userId, targetUserId, now]
		});
	}

	return { message: 'User blocked' };
}

// Unblock user
export async function unblockUser(userId, targetUserId) {
	await db.execute({
		sql: `DELETE FROM friendships 
              WHERE status = 'blocked' 
              AND ((requester_id = ? AND recipient_id = ?) 
              OR (requester_id = ? AND recipient_id = ?))`,
		args: [userId, targetUserId, targetUserId, userId]
	});

	return { message: 'User unblocked' };
}

// Get all friends (accepted)
export async function getFriends(userId) {
	const result = await db.execute({
		sql: `SELECT f.*, 
              u.username, u.is_online, u.is_guest
              FROM friendships f
              JOIN users u ON (
                CASE 
                  WHEN f.requester_id = ? THEN f.recipient_id = u.id
                  ELSE f.requester_id = u.id
                END
              )
              WHERE (f.requester_id = ? OR f.recipient_id = ?) 
              AND f.status = 'accepted'`,
		args: [userId, userId, userId]
	});

	return result.rows;
}

// Get pending friend requests (received)
export async function getPendingRequests(userId) {
	const result = await db.execute({
		sql: `SELECT f.*, u.username, u.is_online
              FROM friendships f
              JOIN users u ON f.requester_id = u.id
              WHERE f.recipient_id = ? AND f.status = 'pending'
              ORDER BY f.created_at DESC`,
		args: [userId]
	});

	return result.rows;
}

// Get sent friend requests
export async function getSentRequests(userId) {
	const result = await db.execute({
		sql: `SELECT f.*, u.username, u.is_online
              FROM friendships f
              JOIN users u ON f.recipient_id = u.id
              WHERE f.requester_id = ? AND f.status = 'pending'
              ORDER BY f.created_at DESC`,
		args: [userId]
	});

	return result.rows;
}

// Get blocked users
export async function getBlockedUsers(userId) {
	const result = await db.execute({
		sql: `SELECT f.*, u.username
              FROM friendships f
              JOIN users u ON f.recipient_id = u.id
              WHERE f.requester_id = ? AND f.status = 'blocked'`,
		args: [userId]
	});

	return result.rows;
}

// Check friendship status between two users
export async function checkFriendshipStatus(userId, targetUserId) {
	const result = await db.execute({
		sql: `SELECT * FROM friendships 
              WHERE (requester_id = ? AND recipient_id = ?) 
              OR (requester_id = ? AND recipient_id = ?)`,
		args: [userId, targetUserId, targetUserId, userId]
	});

	if (result.rows.length === 0) {
		return { status: 'none' };
	}

	return {
		status: result.rows[0].status,
		friendship_id: result.rows[0].id,
		is_requester: result.rows[0].requester_id === userId
	};
}
