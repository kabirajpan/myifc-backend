import { Hono } from 'hono';
import {
	createOrGetChatSession,
	sendMessage,
	getMessages,
	getUserChats,
	markMessagesAsRead,
	getChatSession,
	cleanupOldChats
} from '../services/chat.service.js';
import { authMiddleware } from '../middleware/auth.js';

const chat = new Hono();

// All chat routes require authentication
chat.use('/*', authMiddleware);

// Get all active chats for current user
chat.get('/sessions', async (c) => {
	try {
		const user = c.get('user');
		const chats = await getUserChats(user.id);

		return c.json({
			count: chats.length,
			chats
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Create or get chat session with another user
chat.post('/sessions', async (c) => {
	try {
		const user = c.get('user');
		const { other_user_id } = await c.req.json();

		if (!other_user_id) {
			return c.json({ error: 'other_user_id is required' }, 400);
		}

		if (user.id === other_user_id) {
			return c.json({ error: 'Cannot chat with yourself' }, 400);
		}

		const session = await createOrGetChatSession(user.id, other_user_id);

		return c.json({
			message: 'Chat session created/retrieved',
			session
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get chat session details
chat.get('/sessions/:sessionId', async (c) => {
	try {
		const sessionId = c.req.param('sessionId');
		const session = await getChatSession(sessionId);

		return c.json({ session });
	} catch (error) {
		return c.json({ error: error.message }, 404);
	}
});

// Get messages in a chat session
chat.get('/messages/:sessionId', async (c) => {
	try {
		const user = c.get('user');
		const sessionId = c.req.param('sessionId');

		const messages = await getMessages(sessionId, user.id);

		return c.json({
			count: messages.length,
			messages
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Send a message
chat.post('/messages', async (c) => {
	try {
		const user = c.get('user');
		const { session_id, content, type = 'text' } = await c.req.json();

		if (!session_id || !content) {
			return c.json({ error: 'session_id and content are required' }, 400);
		}

		const message = await sendMessage(session_id, user.id, content, type);

		return c.json({
			message: 'Message sent',
			data: message
		}, 201);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Mark messages as read
chat.put('/messages/read/:sessionId', async (c) => {
	try {
		const user = c.get('user');
		const sessionId = c.req.param('sessionId');

		const result = await markMessagesAsRead(sessionId, user.id);

		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Manual cleanup trigger (for testing or admin use)
chat.post('/cleanup', async (c) => {
	try {
		const result = await cleanupOldChats();
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

export default chat;
