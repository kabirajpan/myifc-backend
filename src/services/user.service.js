import { db } from '../config/db.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { generateId } from '../utils/idGenerator.js';
import { handleUserLogout } from './chat.service.js';
import { markUserRoomsForDeletion } from './room.service.js';

// Create guest user
export async function createGuestUser(data) {
	const { username, gender, age } = data;

	// Validate age
	if (age < 18) {
		throw new Error('You must be 18 or older');
	}

	// Create guest username
	const guestUsername = `guest-${username}-${generateId().substring(0, 6)}`;

	const userId = generateId();
	const now = Date.now();

	await db.execute({
		sql: `INSERT INTO users (id, username, gender, age, is_guest, role, created_at, last_login, is_online)
          VALUES (?, ?, ?, ?, 1, 'guest', ?, ?, 1)`,
		args: [userId, guestUsername, gender, age, now, now]
	});

	// ✅ ADD THIS - Create user session
	await createUserSession(userId);

	return {
		id: userId,
		username: guestUsername,
		gender,
		age,
		role: 'guest',
		is_guest: true
	};
}

// Register user (permanent account)
export async function registerUser(data) {
	const { username, email, password, name, gender, age } = data;

	// Validate age
	if (age < 18) {
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
		sql: `INSERT INTO users (id, username, email, password, name, gender, age, is_guest, role, created_at, last_login, is_online)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'user', ?, ?, 1)`,
		args: [userId, username, email, hashedPassword, name, gender, age, now, now]
	});

	// ✅ ADD THIS - Create user session
	await createUserSession(userId);

	return {
		id: userId,
		username,
		email,
		name,
		gender,
		age,
		role: 'user',
		is_guest: false
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

	// ✅ ADD THIS - Create user session
	await createUserSession(user.id);

	return {
		id: user.id,
		username: user.username,
		email: user.email,
		name: user.name,
		gender: user.gender,
		age: user.age,
		role: user.role,
		is_guest: false
	};
}

// Get user by ID
export async function getUserById(userId) {
	const result = await db.execute({
		sql: 'SELECT id, username, email, name, gender, age, role, is_guest, is_online FROM users WHERE id = ?',
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

	// Set user offline
	await db.execute({
		sql: 'UPDATE users SET is_online = 0 WHERE id = ?',
		args: [userId]
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

	await markUserRoomsForDeletion(userId);

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
		sql: 'SELECT id, username, gender, age, role, is_guest FROM users WHERE is_online = 1'
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
