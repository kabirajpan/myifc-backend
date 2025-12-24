import { Hono } from 'hono';
import {
	createRoom,
	getAllRooms,
	getPublicRooms,
	getRoomById,
	joinRoom,
	leaveRoom,
	sendRoomMessage,
	getRoomMessages,
	getRoomMembers,
	deleteRoom,
	deleteExpiredRooms,
	reactToRoomMessage,
	getRoomMessageReactions,
	removeRoomMessageReaction
} from '../services/room.service.js';
import { authMiddleware, requireRegistered } from '../middleware/auth.js';

const rooms = new Hono();

// Public endpoint - no auth required
rooms.get('/public', async (c) => {
	try {
		const roomsList = await getPublicRooms();
		return c.json({
			count: roomsList.length,
			rooms: roomsList
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// All OTHER room routes require authentication
rooms.use('/*', authMiddleware);

// Get all active rooms
rooms.get('/', async (c) => {
	try {
		const roomsList = await getAllRooms();
		return c.json({
			count: roomsList.length,
			rooms: roomsList
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Create room (registered users only)
rooms.post('/', requireRegistered, async (c) => {
	try {
		const user = c.get('user');
		const { name, description, is_admin_room } = await c.req.json();

		if (!name) {
			return c.json({ error: 'Room name is required' }, 400);
		}

		const room = await createRoom(user.id, name, description, is_admin_room || false);

		return c.json({
			message: 'Room created successfully',
			room
		}, 201);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get room details
rooms.get('/:roomId', async (c) => {
	try {
		const roomId = c.req.param('roomId');
		const room = await getRoomById(roomId);
		return c.json({ room });
	} catch (error) {
		return c.json({ error: error.message }, 404);
	}
});

// Join room
rooms.post('/:roomId/join', async (c) => {
	try {
		const user = c.get('user');
		const roomId = c.req.param('roomId');

		const result = await joinRoom(roomId, user.id);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Leave room
rooms.post('/:roomId/leave', async (c) => {
	try {
		const user = c.get('user');
		const roomId = c.req.param('roomId');

		const result = await leaveRoom(roomId, user.id);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Send message in room - UPDATED
rooms.post('/:roomId/messages', async (c) => {
	try {
		const user = c.get('user');
		const roomId = c.req.param('roomId');
		const {
			content,
			type = 'text',
			reply_to,      // NEW: message_id to reply to
			caption,       // NEW: caption for media messages
			secret_to      // NEW: user_id for secret messages (renamed from recipient_id)
		} = await c.req.json();

		if (!content) {
			return c.json({ error: 'Message content is required' }, 400);
		}

		const message = await sendRoomMessage(
			roomId,
			user.id,
			content,
			type,
			reply_to,    // pass as replyToMessageId
			caption,     // pass as caption
			secret_to    // pass as recipientId
		);

		return c.json({
			message: 'Message sent',
			data: message
		}, 201);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get room messages
rooms.get('/:roomId/messages', async (c) => {
	try {
		const user = c.get('user');
		const roomId = c.req.param('roomId');
		const limit = parseInt(c.req.query('limit') || '100');

		const messages = await getRoomMessages(roomId, user.id, limit);
		return c.json({
			count: messages.length,
			messages
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get room members
rooms.get('/:roomId/members', async (c) => {
	try {
		const roomId = c.req.param('roomId');
		const members = await getRoomMembers(roomId);
		return c.json({
			count: members.length,
			members
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// React to room message - NEW ENDPOINT
rooms.post('/:roomId/messages/:messageId/react', async (c) => {
	try {
		const user = c.get('user');
		const roomId = c.req.param('roomId');
		const messageId = c.req.param('messageId');
		const { emoji } = await c.req.json();

		if (!emoji) {
			return c.json({ error: 'Emoji is required' }, 400);
		}

		const reaction = await reactToRoomMessage(messageId, user.id, emoji);
		return c.json({
			message: 'Reaction added',
			data: reaction
		}, 201);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get reactions for room message - NEW ENDPOINT
rooms.get('/:roomId/messages/:messageId/reactions', async (c) => {
	try {
		const messageId = c.req.param('messageId');
		const reactions = await getRoomMessageReactions(messageId);
		return c.json({
			count: reactions.length,
			reactions
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Remove reaction from room message - NEW ENDPOINT
rooms.delete('/:roomId/reactions/:reactionId', async (c) => {
	try {
		const user = c.get('user');
		const reactionId = c.req.param('reactionId');

		const result = await removeRoomMessageReaction(reactionId, user.id);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Delete room (creator or admin only)
rooms.delete('/:roomId', async (c) => {
	try {
		const user = c.get('user');
		const roomId = c.req.param('roomId');

		const result = await deleteRoom(roomId, user.id);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Cleanup expired rooms (manual trigger or can be called by cron)
rooms.post('/cleanup/expired', async (c) => {
	try {
		const result = await deleteExpiredRooms();
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

export default rooms;
