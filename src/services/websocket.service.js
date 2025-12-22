// WebSocket connection manager
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
