import { db } from '../config/db.js';

// Store active connections: userId -> WebSocket
const connections = new Map();

// Send message to a specific user
export function sendToUser(userId, data) {
	const ws = connections.get(userId);
	if (ws && ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(data));
		return true;
	}
	return false;
}

// Broadcast message to chat participants (excluding sender)
export function broadcastNewMessage(session, message, senderUsername) {
	const recipientId = session.user1_id === message.sender_id
		? session.user2_id
		: session.user1_id;

	sendToUser(recipientId, {
		type: 'new_message',
		data: {
			session_id: session.id,
			message: {
				...message,
				sender_username: senderUsername
			}
		}
	});
}

// Broadcast message to all room members (excluding sender)
export async function broadcastRoomMessage(roomId, message, excludeUserId = null) {
	// Get all room members
	const members = await db.execute({
		sql: 'SELECT user_id FROM room_members WHERE room_id = ?',
		args: [roomId]
	});

	let sentCount = 0;

	for (const member of members.rows) {
		if (excludeUserId && member.user_id === excludeUserId) {
			continue; // Skip sender
		}

		if (sendToUser(member.user_id, {
			type: 'new_message',
			data: {
				room_id: roomId,
				message: {
					...message,
					isOwn: false // For other users
				}
			}
		})) {
			sentCount++;
		}
	}

	console.log(`📢 Broadcast to ${sentCount} room members in room ${roomId}`);
	return sentCount;
}

// Broadcast reaction to room members
export async function broadcastRoomReaction(roomId, reaction, messageId) {
	const members = await db.execute({
		sql: 'SELECT user_id FROM room_members WHERE room_id = ?',
		args: [roomId]
	});

	let sentCount = 0;

	for (const member of members.rows) {
		if (sendToUser(member.user_id, {
			type: 'message_reacted',
			data: {
				room_id: roomId,
				message_id: messageId,
				reaction
			}
		})) {
			sentCount++;
		}
	}

	console.log(`🎭 Broadcast reaction to ${sentCount} room members`);
	return sentCount;
}

// Broadcast user joined/left room
export async function broadcastRoomPresence(roomId, user, action) {
	const members = await db.execute({
		sql: 'SELECT user_id FROM room_members WHERE room_id = ?',
		args: [roomId]
	});

	let sentCount = 0;

	for (const member of members.rows) {
		if (member.user_id === user.id) {
			continue; // Don't send to the user who joined/left
		}

		if (sendToUser(member.user_id, {
			type: 'room_presence',
			data: {
				room_id: roomId,
				user,
				action // 'joined' or 'left'
			}
		})) {
			sentCount++;
		}
	}

	console.log(`👥 Broadcast ${action} to ${sentCount} room members`);
	return sentCount;
}

// Broadcast reaction removal to room members
export async function broadcastRoomReactionRemoval(roomId, reactionId, messageId) {
	const members = await db.execute({
		sql: 'SELECT user_id FROM room_members WHERE room_id = ?',
		args: [roomId]
	});

	let sentCount = 0;

	for (const member of members.rows) {
		if (sendToUser(member.user_id, {
			type: 'reaction_removed',
			data: {
				room_id: roomId,
				message_id: messageId,
				reaction_id: reactionId
			}
		})) {
			sentCount++;
		}
	}

	console.log(`🗑️ Broadcast reaction removal to ${sentCount} room members`);
	return sentCount;
}

// Broadcast reaction to private chat
export function broadcastReaction(sessionId, reaction, messageId, excludeUserId = null) {
	// Get session participants
	const session = connections.get(sessionId); // This needs to get actual session from DB
	// Implementation depends on how sessions are stored

	console.log(`🎭 Broadcast reaction for message ${messageId}`);
	return 0; // Placeholder - need session data
}

// Add connection
export function addConnection(userId, ws) {
	connections.set(userId, ws);
	console.log(`✅ User ${userId} connected. Total connections: ${connections.size}`);
}

// Remove connection
export function removeConnection(userId) {
	connections.delete(userId);
	console.log(`❌ User ${userId} disconnected. Total connections: ${connections.size}`);
}

// Get connection count
export function getConnectionCount() {
	return connections.size;
}

// Get all connected users
export function getConnectedUsers() {
	return Array.from(connections.keys());
}

// Check if user is connected
export function isUserConnected(userId) {
	return connections.has(userId) && connections.get(userId).readyState === WebSocket.OPEN;
}
