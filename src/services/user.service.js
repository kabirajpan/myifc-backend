import { db } from '../config/db.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { generateId } from '../utils/idGenerator.js';
import { handleUserLogout } from './chat.service.js';
import { markUserProjectsForDeletion } from './project.service.js'; // RENAMED from markUserRoomsForDeletion

// Create guest user (clients joining via invite)
export async function createGuestUser(data) {
	const { username, name, gender, age } = data;

	// Validate age if provided
	if (age && age < 18) {
		throw new Error('You must be 18 or older');
	}

	// Create guest username with random suffix
	const guestUsername = `guest-${username || 'user'}-${generateId().substring(0, 6)}`;

	const userId = generateId();
	const now = Date.now();

	await db.execute({
		sql: `INSERT INTO users (id, username, name, gender, age, is_guest, role, created_at, last_login, is_online)
          VALUES (?, ?, ?, ?, ?, 1, 'guest', ?, ?, 1)`,
		args: [userId, guestUsername, name || username || 'Guest', gender || null, age || null, now, now]
	});

	// Create user session
	await createUserSession(userId);

	return {
		id: userId,
		username: guestUsername,
		name: name || username || 'Guest',
		gender: gender || null,
		age: age || null,
		role: 'guest',
		is_guest: true,
		plan: 'free',
		storage_used: 0
	};
}

// Register freelancer user (permanent account)
export async function registerUser(data) {
	const { username, email, password, name, gender, age } = data;

	// Validate required fields
	if (!username || !email || !password || !name) {
		throw new Error('Username, email, password, and name are required');
	}

	// Validate age if provided
	if (age && age < 18) {
		throw new Error('You must be 18 or older');
	}

	// Check if username exists
	const existingUser = await db.execute({
		sql: 'SELECT id FROM users WHERE username = ?',
		args: [username]
	});

	if (existingUser.rows.length > 0) {
		throw new Error('Username already exists');
	}

	// Check if email exists
	const existingEmail = await db.execute({
		sql: 'SELECT id FROM users WHERE email = ?',
		args: [email]
	});

	if (existingEmail.rows.length > 0) {
		throw new Error('Email already exists');
	}

	// Hash password
	const hashedPassword = await hashPassword(password);

	const userId = generateId();
	const now = Date.now();

	await db.execute({
		sql: `INSERT INTO users (id, username, email, password, name, gender, age, is_guest, role, plan, storage_used, created_at, last_login, is_online)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'freelancer', 'free', 0, ?, ?, 1)`,
		args: [userId, username, email, hashedPassword, name, gender || null, age || null, now, now]
	});

	// Create user session
	await createUserSession(userId);

	return {
		id: userId,
		username,
		email,
		name,
		gender: gender || null,
		age: age || null,
		role: 'freelancer',
		is_guest: false,
		plan: 'free',
		storage_used: 0
	};
}

// Register client user (optional - if clients want accounts)
export async function registerClient(data) {
	const { username, email, password, name, gender, age } = data;

	// Validate required fields
	if (!username || !email || !password || !name) {
		throw new Error('Username, email, password, and name are required');
	}

	// Validate age if provided
	if (age && age < 18) {
		throw new Error('You must be 18 or older');
	}

	// Check if username exists
	const existingUser = await db.execute({
		sql: 'SELECT id FROM users WHERE username = ?',
		args: [username]
	});

	if (existingUser.rows.length > 0) {
		throw new Error('Username already exists');
	}

	// Check if email exists
	const existingEmail = await db.execute({
		sql: 'SELECT id FROM users WHERE email = ?',
		args: [email]
	});

	if (existingEmail.rows.length > 0) {
		throw new Error('Email already exists');
	}

	// Hash password
	const hashedPassword = await hashPassword(password);

	const userId = generateId();
	const now = Date.now();

	await db.execute({
		sql: `INSERT INTO users (id, username, email, password, name, gender, age, is_guest, role, plan, storage_used, created_at, last_login, is_online)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'client', 'free', 0, ?, ?, 1)`,
		args: [userId, username, email, hashedPassword, name, gender || null, age || null, now, now]
	});

	// Create user session
	await createUserSession(userId);

	return {
		id: userId,
		username,
		email,
		name,
		gender: gender || null,
		age: age || null,
		role: 'client',
		is_guest: false,
		plan: 'free',
		storage_used: 0
	};
}

// Login user
export async function loginUser(usernameOrEmail, password) {
	// Find user by username or email
	const result = await db.execute({
		sql: 'SELECT * FROM users WHERE username = ? OR email = ?',
		args: [usernameOrEmail, usernameOrEmail]
	});

	if (result.rows.length === 0) {
		throw new Error('Invalid credentials');
	}

	const user = result.rows[0];

	// Check if guest (guests don't have passwords)
	if (user.is_guest) {
		throw new Error('Guest users cannot login with password');
	}

	// Check if user has a password (some users might not)
	if (!user.password) {
		throw new Error('Invalid credentials');
	}

	// Verify password
	const isValid = await comparePassword(password, user.password);

	if (!isValid) {
		throw new Error('Invalid credentials');
	}

	// Update last login and online status
	const now = Date.now();
	await db.execute({
		sql: 'UPDATE users SET last_login = ?, is_online = 1 WHERE id = ?',
		args: [now, user.id]
	});

	// Create user session
	await createUserSession(user.id);

	return {
		id: user.id,
		username: user.username,
		email: user.email,
		name: user.name,
		gender: user.gender,
		age: user.age,
		role: user.role,
		is_guest: false,
		plan: user.plan,
		storage_used: user.storage_used
	};
}

// Get user by ID
export async function getUserById(userId) {
	const result = await db.execute({
		sql: 'SELECT id, username, email, name, gender, age, role, is_guest, plan, storage_used, is_online, last_seen_at FROM users WHERE id = ?',
		args: [userId]
	});

	if (result.rows.length === 0) {
		throw new Error('User not found');
	}

	return result.rows[0];
}

// Logout user
export async function logoutUser(userId) {
	const now = Date.now();

	// Set user offline and update last_seen_at
	await db.execute({
		sql: 'UPDATE users SET is_online = 0, last_seen_at = ? WHERE id = ?',
		args: [now, userId]
	});

	// Update user session (set logout time)
	await db.execute({
		sql: 'UPDATE user_sessions SET logout_at = ?, is_active = 0 WHERE user_id = ? AND is_active = 1',
		args: [now, userId]
	});

	// Mark chat sessions for deletion check
	await db.execute({
		sql: `UPDATE chat_sessions 
          SET user1_logged_out = CASE WHEN user1_id = ? THEN 1 ELSE user1_logged_out END,
              user2_logged_out = CASE WHEN user2_id = ? THEN 1 ELSE user2_logged_out END
          WHERE (user1_id = ? OR user2_id = ?) AND is_active = 1`,
		args: [userId, userId, userId, userId]
	});

	await handleUserLogout(userId);

	// Mark user projects for deletion (if they're guests)
	await markUserProjectsForDeletion(userId);

	return { message: 'Logged out successfully' };
}

// Create user session on login
export async function createUserSession(userId) {
	const sessionId = generateId();
	const now = Date.now();

	await db.execute({
		sql: 'INSERT INTO user_sessions (id, user_id, login_at, is_active) VALUES (?, ?, ?, 1)',
		args: [sessionId, userId, now]
	});

	return sessionId;
}

// Update profile
export async function updateProfile(userId, data) {
	const { name, age, gender } = data;
	const fields = [];
	const values = [];

	if (name !== undefined) {
		fields.push('name = ?');
		values.push(name);
	}
	if (age !== undefined) {
		if (age < 18) {
			throw new Error('Age must be 18 or older');
		}
		fields.push('age = ?');
		values.push(age);
	}
	if (gender !== undefined) {
		fields.push('gender = ?');
		values.push(gender);
	}

	if (fields.length === 0) {
		throw new Error('No fields to update');
	}

	values.push(userId);

	await db.execute({
		sql: `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
		args: values
	});

	return getUserById(userId);
}

// Upgrade to pro plan
export async function upgradeToPro(userId) {
	await db.execute({
		sql: 'UPDATE users SET plan = ? WHERE id = ?',
		args: ['pro', userId]
	});

	return getUserById(userId);
}

// Update storage usage (when files are uploaded)
export async function updateStorageUsage(userId, bytesToAdd) {
	await db.execute({
		sql: 'UPDATE users SET storage_used = storage_used + ? WHERE id = ?',
		args: [bytesToAdd, userId]
	});

	return getUserById(userId);
}

// Get storage info
export async function getStorageInfo(userId) {
	const user = await getUserById(userId);

	const STORAGE_LIMITS = {
		free: 100 * 1024 * 1024,      // 100MB
		pro: 10 * 1024 * 1024 * 1024  // 10GB
	};

	const limit = STORAGE_LIMITS[user.plan] || STORAGE_LIMITS.free;
	const used = user.storage_used || 0;
	const remaining = limit - used;
	const percentage = (used / limit) * 100;

	return {
		plan: user.plan,
		used,
		limit,
		remaining,
		percentage: Math.round(percentage * 100) / 100,
		formatted: {
			used: formatBytes(used),
			limit: formatBytes(limit),
			remaining: formatBytes(remaining)
		}
	};
}

// Helper: Format bytes to human readable
function formatBytes(bytes) {
	if (bytes === 0) return '0 Bytes';
	const k = 1024;
	const sizes = ['Bytes', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Check username availability
export async function checkUsernameAvailable(username) {
	const result = await db.execute({
		sql: 'SELECT id FROM users WHERE username = ?',
		args: [username]
	});

	return result.rows.length === 0;
}

// Get all online users
export async function getOnlineUsers() {
	const result = await db.execute({
		sql: 'SELECT id, username, name, gender, age, role, is_guest FROM users WHERE is_online = 1'
	});

	return result.rows;
}

// Get all freelancers (for admin dashboard)
export async function getAllFreelancers() {
	const result = await db.execute({
		sql: 'SELECT id, username, email, name, plan, storage_used, created_at, last_login FROM users WHERE role = ? ORDER BY created_at DESC',
		args: ['freelancer']
	});

	return result.rows;
}

// Delete account
export async function deleteAccount(userId) {
	await db.execute({
		sql: 'DELETE FROM users WHERE id = ?',
		args: [userId]
	});

	return { message: 'Account deleted successfully' };
}
