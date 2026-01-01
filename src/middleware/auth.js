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
					sql: `UPDATE users SET role = 'freelancer' WHERE id = ?`,
					args: [user.id]
				});
				await db.execute({
					sql: `UPDATE bans SET is_active = 0 WHERE id = ?`,
					args: [ban.id]
				});
				user.role = 'freelancer'; // Update in memory
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

		// Attach user to context
		c.set('user', user);
		await next();
	} catch (error) {
		return c.json({ error: error.message || 'Authentication failed' }, 401);
	}
}

// Check if user is registered freelancer (not guest or client)
export async function requireFreelancer(c, next) {
	const user = c.get('user');
	if (user.role !== 'freelancer') {
		return c.json({ error: 'This action requires a freelancer account' }, 403);
	}
	await next();
}

// Check if user is freelancer or client (not guest)
export async function requireRegistered(c, next) {
	const user = c.get('user');
	if (user.role === 'guest' || user.is_guest) {
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

// Check if user is admin or freelancer (for certain project actions)
export async function requireAdminOrFreelancer(c, next) {
	const user = c.get('user');
	if (user.role !== 'admin' && user.role !== 'freelancer') {
		return c.json({ error: 'Admin or Freelancer access required' }, 403);
	}
	await next();
}

// Check if user has access to a specific project (creator or member)
export async function requireProjectAccess(c, next) {
	const user = c.get('user');
	const projectId = c.req.param('id') || c.req.param('projectId');

	if (!projectId) {
		return c.json({ error: 'Project ID required' }, 400);
	}

	// Check if user is project creator
	const projectResult = await db.execute({
		sql: 'SELECT * FROM projects WHERE id = ?',
		args: [projectId]
	});

	if (projectResult.rows.length === 0) {
		return c.json({ error: 'Project not found' }, 404);
	}

	const project = projectResult.rows[0];

	// Admin has access to all projects
	if (user.role === 'admin') {
		c.set('project', project);
		await next();
		return;
	}

	// Check if user is creator
	if (project.creator_id === user.id) {
		c.set('project', project);
		c.set('isProjectCreator', true);
		await next();
		return;
	}

	// Check if user is a member
	const memberResult = await db.execute({
		sql: 'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
		args: [projectId, user.id]
	});

	if (memberResult.rows.length > 0) {
		c.set('project', project);
		c.set('isProjectCreator', false);
		await next();
		return;
	}

	return c.json({ error: 'You do not have access to this project' }, 403);
}

// Check if user is the project creator (not just a member)
export async function requireProjectCreator(c, next) {
	const user = c.get('user');
	const projectId = c.req.param('id') || c.req.param('projectId');

	if (!projectId) {
		return c.json({ error: 'Project ID required' }, 400);
	}

	// Admin has creator access to all projects
	if (user.role === 'admin') {
		await next();
		return;
	}

	const projectResult = await db.execute({
		sql: 'SELECT * FROM projects WHERE id = ? AND creator_id = ?',
		args: [projectId, user.id]
	});

	if (projectResult.rows.length === 0) {
		return c.json({ error: 'You must be the project creator to perform this action' }, 403);
	}

	c.set('project', projectResult.rows[0]);
	await next();
}

// Check if user has pro plan (for storage/feature limits)
export async function requireProPlan(c, next) {
	const user = c.get('user');
	if (user.plan !== 'pro') {
		return c.json({
			error: 'This feature requires a Pro plan',
			upgrade_url: '/upgrade'
		}, 403);
	}
	await next();
}

// Check storage limit before upload
export async function checkStorageLimit(c, next) {
	const user = c.get('user');

	// Get file size from request (you'll need to parse this from multipart form)
	const fileSize = parseInt(c.req.header('Content-Length') || '0');

	// Define storage limits
	const STORAGE_LIMITS = {
		free: 100 * 1024 * 1024,      // 100MB
		pro: 10 * 1024 * 1024 * 1024  // 10GB
	};

	const limit = STORAGE_LIMITS[user.plan] || STORAGE_LIMITS.free;

	if (user.storage_used + fileSize > limit) {
		return c.json({
			error: 'Storage limit exceeded',
			current_usage: user.storage_used,
			limit: limit,
			file_size: fileSize,
			upgrade_url: user.plan === 'free' ? '/upgrade' : null
		}, 403);
	}

	await next();
}

// Optional: Middleware to allow guests with valid project invite token
export async function authOrGuestWithInvite(c, next) {
	try {
		const authHeader = c.req.header('Authorization');
		if (!authHeader || !authHeader.startsWith('Bearer ')) {
			return c.json({ error: 'No token provided' }, 401);
		}

		const token = authHeader.substring(7);
		const decoded = verifyToken(token);

		// If it's a guest token with project access
		if (decoded.type === 'guest' && decoded.projectId) {
			// Verify guest has access to this project
			const projectResult = await db.execute({
				sql: 'SELECT * FROM projects WHERE id = ? AND status = ?',
				args: [decoded.projectId, 'active']
			});

			if (projectResult.rows.length === 0) {
				return c.json({ error: 'Invalid or inactive project' }, 403);
			}

			// Create a temporary guest user object
			c.set('user', {
				id: decoded.guestId,
				role: 'guest',
				is_guest: true,
				projectId: decoded.projectId,
				name: decoded.name || 'Guest'
			});
			await next();
			return;
		}

		// Otherwise, treat as regular user
		const user = await getUserById(decoded.userId);
		c.set('user', user);
		await next();
	} catch (error) {
		return c.json({ error: error.message || 'Authentication failed' }, 401);
	}
}
