import { Hono } from 'hono';
import {
	createGuestUser,
	registerUser,
	loginUser,
	logoutUser,
	updateProfile,
	checkUsernameAvailable,
	getOnlineUsers,
	deleteAccount
} from '../services/user.service.js';
import { generateToken } from '../utils/jwt.js';
import { authMiddleware, requireRegistered } from '../middleware/auth.js';

const auth = new Hono();

// Guest login (no password)
auth.post('/guest-login', async (c) => {
	try {
		const { username, gender, age } = await c.req.json();

		if (!username || !gender || !age) {
			return c.json({ error: 'Username, gender, and age are required' }, 400);
		}

		const user = await createGuestUser({ username, gender, age });
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

// Register (permanent account)
auth.post('/register', async (c) => {
	try {
		const { username, email, password, name, gender, age } = await c.req.json();

		if (!username || !email || !password || !gender || !age) {
			return c.json({ error: 'All fields are required' }, 400);
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

// Login (for registered users)
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
