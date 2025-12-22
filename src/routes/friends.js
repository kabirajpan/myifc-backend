import { Hono } from 'hono';
import {
	sendFriendRequest,
	acceptFriendRequest,
	rejectFriendRequest,
	blockUser,
	unblockUser,
	getFriends,
	getPendingRequests,
	getSentRequests,
	getBlockedUsers,
	checkFriendshipStatus
} from '../services/friend.service.js';
import { authMiddleware, requireRegistered } from '../middleware/auth.js';

const friends = new Hono();

// All friend routes require authentication and registered user
friends.use('/*', authMiddleware, requireRegistered);

// Send friend request
friends.post('/request', async (c) => {
	try {
		const user = c.get('user');
		const { recipient_id } = await c.req.json();

		if (!recipient_id) {
			return c.json({ error: 'recipient_id is required' }, 400);
		}

		if (user.id === recipient_id) {
			return c.json({ error: 'Cannot send friend request to yourself' }, 400);
		}

		const friendship = await sendFriendRequest(user.id, recipient_id);
		return c.json({
			message: 'Friend request sent',
			friendship
		}, 201);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Accept friend request
friends.post('/accept/:friendshipId', async (c) => {
	try {
		const user = c.get('user');
		const friendshipId = c.req.param('friendshipId');

		const result = await acceptFriendRequest(user.id, friendshipId);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Reject friend request
friends.post('/reject/:friendshipId', async (c) => {
	try {
		const user = c.get('user');
		const friendshipId = c.req.param('friendshipId');

		const result = await rejectFriendRequest(user.id, friendshipId);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Block user
friends.post('/block', async (c) => {
	try {
		const user = c.get('user');
		const { user_id } = await c.req.json();

		if (!user_id) {
			return c.json({ error: 'user_id is required' }, 400);
		}

		const result = await blockUser(user.id, user_id);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Unblock user
friends.post('/unblock/:userId', async (c) => {
	try {
		const user = c.get('user');
		const targetUserId = c.req.param('userId');

		const result = await unblockUser(user.id, targetUserId);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get all friends
friends.get('/', async (c) => {
	try {
		const user = c.get('user');
		const friendsList = await getFriends(user.id);
		return c.json({
			count: friendsList.length,
			friends: friendsList
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get pending requests (received)
friends.get('/requests/pending', async (c) => {
	try {
		const user = c.get('user');
		const requests = await getPendingRequests(user.id);
		return c.json({
			count: requests.length,
			requests
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get sent requests
friends.get('/requests/sent', async (c) => {
	try {
		const user = c.get('user');
		const requests = await getSentRequests(user.id);
		return c.json({
			count: requests.length,
			requests
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get blocked users
friends.get('/blocked', async (c) => {
	try {
		const user = c.get('user');
		const blocked = await getBlockedUsers(user.id);
		return c.json({
			count: blocked.length,
			blocked
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Check friendship status with specific user
friends.get('/status/:userId', async (c) => {
	try {
		const user = c.get('user');
		const targetUserId = c.req.param('userId');

		const status = await checkFriendshipStatus(user.id, targetUserId);
		return c.json(status);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

export default friends;
