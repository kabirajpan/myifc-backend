import { createClient } from '@libsql/client';
import dotenv from 'dotenv';

dotenv.config();

export const db = createClient({
	url: process.env.DATABASE_URL,
	authToken: process.env.DATABASE_AUTH_TOKEN
});

// 1. Users table (guest + registered users)
export async function createUsersTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password TEXT,
      name TEXT,
      gender TEXT NOT NULL CHECK(gender IN ('male', 'female', 'other')),
      age INTEGER NOT NULL CHECK(age >= 18),
      role TEXT DEFAULT 'guest' CHECK(role IN ('guest', 'user', 'admin', 'moderator', 'banned')),
      is_guest BOOLEAN DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_login INTEGER,
      is_online BOOLEAN DEFAULT 0
    )
  `);
	console.log('✅ Users table created');
}

// 2. Friendships table (friend requests for registered users only)
export async function createFriendshipsTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'blocked')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(requester_id, recipient_id)
    )
  `);
	console.log('✅ Friendships table created');
}

// 3. Chat sessions (anyone can message anyone - no restrictions)
export async function createChatSessionsTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user1_id TEXT NOT NULL,
      user2_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      user1_logged_out BOOLEAN DEFAULT 0,
      user2_logged_out BOOLEAN DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user1_id, user2_id)
    )
  `);
	console.log('✅ Chat sessions table created');
}

// 4. Messages (text, image, gif, audio, emoji)
// Updated Messages table with visibility flags
export async function createMessagesTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'text' CHECK(type IN ('text', 'image', 'gif', 'audio', 'emoji')),
      created_at INTEGER NOT NULL,
      is_read BOOLEAN DEFAULT 0,
      visible_to_user1 BOOLEAN DEFAULT 1,
      visible_to_user2 BOOLEAN DEFAULT 1,
      reply_to_message_id TEXT,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reply_to_message_id) REFERENCES messages(id) ON DELETE SET NULL
    )
  `);
	console.log('✅ Messages table created with reply support');
}

// 5. User sessions (track login/logout for chat deletion logic)
export async function createUserSessionsTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      login_at INTEGER NOT NULL,
      logout_at INTEGER,
      is_active BOOLEAN DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
	console.log('✅ User sessions table created');
}

// 6. Rooms table
export async function createRoomsTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      creator_id TEXT NOT NULL,
      is_admin_room BOOLEAN DEFAULT 0,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      is_active BOOLEAN DEFAULT 1,
      FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
	console.log('✅ Rooms table created');
}

// 7. Room messages
export async function createRoomMessagesTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS room_messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      recipient_id TEXT,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'text' CHECK(type IN ('text', 'image', 'gif', 'audio', 'emoji', 'system', 'secret')),
      created_at INTEGER NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
	console.log('✅ Room messages table created');
}

// 8. Room members (who's currently in the room)
export async function createRoomMembersTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS room_members (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(room_id, user_id)
    )
  `);
	console.log('✅ Room members table created');
}

// 9. Bans table (track temporary and permanent bans)
export async function createBansTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS bans (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      banned_by TEXT NOT NULL,
      reason TEXT,
      duration_days INTEGER,
      banned_at INTEGER NOT NULL,
      expires_at INTEGER,
      is_permanent BOOLEAN DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
	console.log('✅ Bans table created');
}

// Initialize all tables
export async function initDatabase() {
	await createUsersTable();
	await createFriendshipsTable();
	await createChatSessionsTable();
	await createMessagesTable();
	await createUserSessionsTable();
	await createRoomsTable();
	await createRoomMessagesTable();
	await createRoomMembersTable();
	await createBansTable();
	console.log('🎉 All tables initialized');
}
