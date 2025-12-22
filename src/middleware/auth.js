import { verifyToken } from '../utils/jwt.js';
import { getUserById } from '../services/user.service.js';
import { db } from '../config/db.js';

// Verify JWT token middleware
export async function authMiddleware(c, next) {
	try {
		const authHeader = c.req.header('Authorization');
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return c.json({ error: 'No token provided' }, 401);
		}
		const token = authHeader.substring(7); // Remove 'Bearer '

		// Verify token
		const decoded = verifyToken(token);

		// Get user from database
		const user = await getUserById(decoded.userId);

		// Check if user is banned
		if (user.role === 'banned') {
			// Check if ban is temporary and expired
			const banResult = await db.execute({
				sql: `SELECT * FROM bans 
				      WHERE user_id = ? AND is_active = 1 
				      ORDER BY banned_at DESC LIMIT 1`,
				args: [user.id]
			});

			if (banResult.rows.length > 0) {
				const ban = banResult.rows[0];
				const now = Date.now();

				// If temporary ban expired, unban user
				if (!ban.is_permanent && ban.expires_at && ban.expires_at < now) {
					await db.execute({
						sql: `UPDATE users SET role = 'user' WHERE id = ?`,
						args: [user.id]
					});
					await db.execute({
						sql: `UPDATE bans SET is_active = 0 WHERE id = ?`,
						args: [ban.id]
					});
					user.role = 'user'; // Update in memory
				} else {
					// Still banned
					const timeLeft = ban.is_permanent ? 'permanent' :
						Math.ceil((ban.expires_at - now) / (24 * 60 * 60 * 1000)) + ' days';
					return c.json({
						error: 'Your account is banned',
						reason: ban.reason,
						banned_until: ban.is_permanent ? 'permanent' : new Date(ban.expires_at).toISOString(),
						time_left: timeLeft
					}, 403);
				}
			}
		}

		// Attach user to context
		c.set('user', user);
		await next();
	} catch (error) {
		return c.json({ error: error.message || 'Authentication failed' }, 401);
	}
}

// Check if user is registered (not guest)
export async function requireRegistered(c, next) {
	const user = c.get('user');
	if (user.is_guest) {
		return c.json({ error: 'This action requires a registered account' }, 403);
	}
	await next();
}

// Check if user is admin
export async function requireAdmin(c, next) {
	const user = c.get('user');
	if (user.role !== 'admin') {
		return c.json({ error: 'Admin access required' }, 403);
	}
	await next();
}

// Check if user is moderator or admin
export async function requireModerator(c, next) {
	const user = c.get('user');
	if (user.role !== 'moderator' && user.role !== 'admin') {
		return c.json({ error: 'Moderator or Admin access required' }, 403);
	}
	await next();
}

// Check if user is admin only (not moderator)
export async function requireAdminOnly(c, next) {
	const user = c.get('user');
	if (user.role !== 'admin') {
		return c.json({ error: 'Admin-only access required' }, 403);
	}
	await next();
}
