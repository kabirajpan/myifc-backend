import { Hono } from 'hono';
import { authMiddleware, requireModerator, requireAdminOnly } from '../middleware/auth.js';
import * as adminService from '../services/admin.service.js';

const admin = new Hono();

// All routes require at least moderator role
admin.use('/*', authMiddleware, requireModerator);

// ==================== DASHBOARD ====================

// Get dashboard stats
admin.get('/stats', async (c) => {
	try {
		const stats = await adminService.getStats();
		return c.json(stats);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// ==================== USER MANAGEMENT ====================

// Get all users (with optional filters)
admin.get('/users', async (c) => {
	try {
		const role = c.req.query('role');
		const isOnline = c.req.query('isOnline');
		const search = c.req.query('search');

		const filters = {};
		if (role) filters.role = role;
		if (isOnline !== undefined) filters.isOnline = isOnline === 'true';
		if (search) filters.search = search;

		const users = await adminService.getAllUsers(filters);
		return c.json({ count: users.length, users });
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get user details
admin.get('/users/:id', async (c) => {
	try {
		const userId = c.req.param('id');
		const data = await adminService.getUserDetails(userId);
		return c.json(data);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Ban user
admin.post('/users/:id/ban', async (c) => {
	try {
		const userId = c.req.param('id');
		const currentUser = c.get('user');
		const { duration_days, reason } = await c.req.json();

		// Validate duration
		const validDurations = [1, 3];
		if (currentUser.role === 'admin') {
			validDurations.push(null); // Admin can do permanent
		}

		if (duration_days !== null && !validDurations.includes(duration_days)) {
			return c.json({
				error: currentUser.role === 'moderator'
					? 'Moderators can only ban for 1 or 3 days'
					: 'Invalid duration'
			}, 400);
		}

		const result = await adminService.banUser(
			userId,
			currentUser.id,
			duration_days,
			reason || 'Violation of terms'
		);

		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Unban user
admin.post('/users/:id/unban', async (c) => {
	try {
		const userId = c.req.param('id');
		const currentUser = c.get('user');

		const result = await adminService.unbanUser(userId, currentUser.id);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Delete user (admin only)
admin.delete('/users/:id', requireAdminOnly, async (c) => {
	try {
		const userId = c.req.param('id');
		const result = await adminService.deleteUser(userId);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Promote user (admin only)
admin.post('/users/:id/promote', requireAdminOnly, async (c) => {
	try {
		const userId = c.req.param('id');
		const { role } = await c.req.json();

		if (!role || !['moderator', 'admin'].includes(role)) {
			return c.json({ error: 'Invalid role. Must be moderator or admin' }, 400);
		}

		const result = await adminService.promoteUser(userId, role);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Demote user (admin only)
admin.post('/users/:id/demote', requireAdminOnly, async (c) => {
	try {
		const userId = c.req.param('id');
		const result = await adminService.demoteUser(userId);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// ==================== CHAT MODERATION ====================

// Get all chats
admin.get('/chats', async (c) => {
	try {
		const chats = await adminService.getAllChats();
		return c.json({ count: chats.length, chats });
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get chat messages
admin.get('/chats/:id/messages', async (c) => {
	try {
		const sessionId = c.req.param('id');
		const messages = await adminService.getChatMessages(sessionId);
		return c.json({ count: messages.length, messages });
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Delete message
admin.delete('/messages/:id', async (c) => {
	try {
		const messageId = c.req.param('id');
		const result = await adminService.deleteMessage(messageId);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Delete chat
admin.delete('/chats/:id', async (c) => {
	try {
		const sessionId = c.req.param('id');
		const result = await adminService.deleteChat(sessionId);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// ==================== ROOM MANAGEMENT ====================

// Get all rooms
admin.get('/rooms', async (c) => {
	try {
		const rooms = await adminService.getAllRooms();
		return c.json({ count: rooms.length, rooms });
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get room details
admin.get('/rooms/:id', async (c) => {
	try {
		const roomId = c.req.param('id');
		const data = await adminService.getRoomDetails(roomId);
		return c.json(data);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Create admin room (admin only)
admin.post('/rooms', requireAdminOnly, async (c) => {
	try {
		const currentUser = c.get('user');
		const { name, description } = await c.req.json();

		if (!name) {
			return c.json({ error: 'Room name is required' }, 400);
		}

		const room = await adminService.createAdminRoom(currentUser.id, name, description);
		return c.json({ message: 'Admin room created', room }, 201);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Update room
admin.put('/rooms/:id', async (c) => {
	try {
		const roomId = c.req.param('id');
		const updates = await c.req.json();

		const result = await adminService.updateRoom(roomId, updates);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Delete room
admin.delete('/rooms/:id', async (c) => {
	try {
		const roomId = c.req.param('id');
		const result = await adminService.deleteRoom(roomId);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Kick user from room
admin.delete('/rooms/:roomId/members/:userId', async (c) => {
	try {
		const roomId = c.req.param('roomId');
		const userId = c.req.param('userId');

		const result = await adminService.kickUserFromRoom(roomId, userId);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Delete room message
admin.delete('/room-messages/:id', async (c) => {
	try {
		const messageId = c.req.param('id');
		const result = await adminService.deleteRoomMessage(messageId);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

export default admin;
