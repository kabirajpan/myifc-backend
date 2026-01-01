import { Hono } from 'hono';
import {
	createGuestUser,
	registerUser,
	registerClient,
	loginUser,
	logoutUser,
	updateProfile,
	upgradeToPro,
	getStorageInfo,
	checkUsernameAvailable,
	getOnlineUsers,
	getAllFreelancers,
	deleteAccount
} from '../services/user.service.js';
import { generateToken } from '../utils/jwt.js';
import { authMiddleware, requireRegistered, requireFreelancer, requireAdmin } from '../middleware/auth.js';

const auth = new Hono();

// Guest login (no password) - For clients joining via invite
auth.post('/guest-login', async (c) => {
	try {
		const { username, name, gender, age } = await c.req.json();

		if (!username && !name) {
			return c.json({ error: 'Username or name is required' }, 400);
		}

		const user = await createGuestUser({ username, name, gender, age });
		const token = generateToken(user);

		return c.json({
			message: 'Guest logged in successfully',
			user,
			token
		}, 201);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Register freelancer (permanent account) - Main registration
auth.post('/register', async (c) => {
	try {
		const { username, email, password, name, gender, age } = await c.req.json();

		if (!username || !email || !password || !name) {
			return c.json({ error: 'Username, email, password, and name are required' }, 400);
		}

		const user = await registerUser({ username, email, password, name, gender, age });
		const token = generateToken(user);

		return c.json({
			message: 'Registration successful',
			user,
			token
		}, 201);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Register client (optional - if clients want permanent accounts)
auth.post('/register-client', async (c) => {
	try {
		const { username, email, password, name, gender, age } = await c.req.json();

		if (!username || !email || !password || !name) {
			return c.json({ error: 'Username, email, password, and name are required' }, 400);
		}

		const user = await registerClient({ username, email, password, name, gender, age });
		const token = generateToken(user);

		return c.json({
			message: 'Client registration successful',
			user,
			token
		}, 201);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Login (for registered users - freelancers and clients)
auth.post('/login', async (c) => {
	try {
		const { usernameOrEmail, password } = await c.req.json();

		if (!usernameOrEmail || !password) {
			return c.json({ error: 'Username/email and password are required' }, 400);
		}

		const user = await loginUser(usernameOrEmail, password);
		const token = generateToken(user);

		return c.json({
			message: 'Login successful',
			user,
			token
		});
	} catch (error) {
		return c.json({ error: error.message }, 401);
	}
});

// Logout
auth.post('/logout', authMiddleware, async (c) => {
	try {
		const user = c.get('user');
		const result = await logoutUser(user.id);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get current user info (protected route)
auth.get('/me', authMiddleware, async (c) => {
	const user = c.get('user');
	return c.json({ user });
});

// Update profile (protected, only for registered users)
auth.put('/profile', authMiddleware, requireRegistered, async (c) => {
	try {
		const user = c.get('user');
		const data = await c.req.json();
		const updatedUser = await updateProfile(user.id, data);

		return c.json({
			message: 'Profile updated successfully',
			user: updatedUser
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Upgrade to pro plan (protected, freelancers only)
auth.post('/upgrade-to-pro', authMiddleware, requireFreelancer, async (c) => {
	try {
		const user = c.get('user');

		// In production, you'd integrate with Stripe/payment gateway here
		// For now, we'll just upgrade them directly

		const updatedUser = await upgradeToPro(user.id);

		return c.json({
			message: 'Successfully upgraded to Pro plan',
			user: updatedUser
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get storage info (protected)
auth.get('/storage', authMiddleware, async (c) => {
	try {
		const user = c.get('user');
		const storageInfo = await getStorageInfo(user.id);

		return c.json({
			storage: storageInfo
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Check username availability
auth.get('/check-username/:username', async (c) => {
	try {
		const username = c.req.param('username');
		const available = await checkUsernameAvailable(username);

		return c.json({
			username,
			available
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get all online users
auth.get('/online-users', authMiddleware, async (c) => {
	try {
		const users = await getOnlineUsers();

		return c.json({
			count: users.length,
			users
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get all freelancers (admin only)
auth.get('/freelancers', authMiddleware, requireAdmin, async (c) => {
	try {
		const freelancers = await getAllFreelancers();

		return c.json({
			count: freelancers.length,
			freelancers
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Delete account (protected)
auth.delete('/account', authMiddleware, async (c) => {
	try {
		const user = c.get('user');
		const result = await deleteAccount(user.id);

		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

export default auth;
