import { createClient } from '@libsql/client';
import dotenv from 'dotenv';

dotenv.config();

export const db = createClient({
	url: process.env.DATABASE_URL,
	authToken: process.env.DATABASE_AUTH_TOKEN
});

// 1. Users table - UPDATED for freelancer platform
export async function createUsersTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password TEXT,
      name TEXT NOT NULL,
      gender TEXT CHECK(gender IN ('male', 'female', 'other')),
      age INTEGER CHECK(age >= 18),
      role TEXT DEFAULT 'freelancer' CHECK(role IN ('guest', 'client', 'freelancer', 'admin')),
      is_guest BOOLEAN DEFAULT 0,
      plan TEXT DEFAULT 'free' CHECK(plan IN ('free', 'pro')),
      storage_used INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      last_login INTEGER,
      is_online BOOLEAN DEFAULT 0,
      last_seen_at INTEGER
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

// 3. Chat sessions - UPDATED with Telegram-style auto-delete
export async function createChatSessionsTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user1_id TEXT NOT NULL,
      user2_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      auto_delete_duration INTEGER DEFAULT 0,
      user1_logged_out BOOLEAN DEFAULT 0,
      user2_logged_out BOOLEAN DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      user1_last_read_message_id TEXT,
      user2_last_read_message_id TEXT,
      FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user1_id, user2_id)
    )
  `);
	console.log('✅ Chat sessions table created');
}

// 4. Messages - UPDATED with new media types
export async function createMessagesTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'text' CHECK(type IN (
        'text', 'image', 'gif', 'audio', 'video', 'pdf', 'document',
        'spreadsheet', 'presentation', 'archive', 'code', 'emoji'
      )),
      created_at INTEGER NOT NULL,
      is_read BOOLEAN DEFAULT 0,
      visible_to_user1 BOOLEAN DEFAULT 1,
      visible_to_user2 BOOLEAN DEFAULT 1,
      reply_to_message_id TEXT,
      caption TEXT,
      status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'delivered', 'read', 'deleted')),
      delivered_at INTEGER,
      read_at INTEGER,
      deleted_at INTEGER,
      deleted_by TEXT,
      edited_at INTEGER,
      is_edited BOOLEAN DEFAULT 0,
      media_id TEXT REFERENCES media(id),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reply_to_message_id) REFERENCES messages(id) ON DELETE SET NULL
    )
  `);
	console.log('✅ Messages table created with new media types');
}

// 5. Message reactions (for private chat)
export async function createMessageReactionsTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS message_reactions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
	console.log('✅ Message reactions table created');
}

// 6. User sessions (track login/logout for chat deletion logic)
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

// 7. Projects table - RENAMED from rooms, UPDATED for freelancer platform
export async function createProjectsTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      creator_id TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'archived')),
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      archived_at INTEGER,
      FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
	console.log('✅ Projects table created');
}

// 8. Project messages - RENAMED from room_messages, UPDATED with new media types
export async function createProjectMessagesTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS project_messages (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      recipient_id TEXT,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'text' CHECK(type IN (
        'text', 'image', 'gif', 'audio', 'video', 'pdf', 'document',
        'spreadsheet', 'presentation', 'archive', 'code', 'emoji', 'system', 'secret'
      )),
      created_at INTEGER NOT NULL,
      is_read BOOLEAN DEFAULT 0,
      caption TEXT,
      reply_to_message_id TEXT,
      deleted_at INTEGER,
      deleted_by TEXT,
      edited_at INTEGER,
      is_edited BOOLEAN DEFAULT 0,
      media_id TEXT REFERENCES media(id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (reply_to_message_id) REFERENCES project_messages(id) ON DELETE SET NULL
    )
  `);
	console.log('✅ Project messages table created');
}

// 9. Project message reactions - RENAMED from room_message_reactions
export async function createProjectMessageReactionsTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS project_message_reactions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      emoji TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (message_id) REFERENCES project_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
	console.log('✅ Project message reactions table created');
}

// 10. Project members - RENAMED from room_members
export async function createProjectMembersTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS project_members (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      last_read_message_id TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(project_id, user_id)
    )
  `);
	console.log('✅ Project members table created');
}

// 11. Bans table (track temporary and permanent bans)
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

// 12. Media table - UPDATED with new media types
export async function createMediaTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      public_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN (
        'image', 'gif', 'audio', 'video', 'pdf', 'document',
        'spreadsheet', 'presentation', 'archive', 'code'
      )),
      filename TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
	console.log('✅ Media table created');
}

// 13. Typing indicators - UPDATED for projects
export async function createTypingIndicatorsTable() {
	await db.execute(`
    CREATE TABLE IF NOT EXISTS typing_indicators (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      project_id TEXT,
      user_id TEXT NOT NULL,
      is_typing BOOLEAN DEFAULT 1,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
	console.log('✅ Typing indicators table created');
}

// Initialize all tables
export async function initDatabase() {
	await createUsersTable();
	await createFriendshipsTable();
	await createChatSessionsTable();
	await createMessagesTable();
	await createMessageReactionsTable();
	await createUserSessionsTable();
	await createProjectsTable();              // RENAMED from createRoomsTable
	await createProjectMessagesTable();       // RENAMED from createRoomMessagesTable
	await createProjectMessageReactionsTable(); // RENAMED from createRoomMessageReactionsTable
	await createProjectMembersTable();        // RENAMED from createRoomMembersTable
	await createBansTable();
	await createMediaTable();
	await createTypingIndicatorsTable();
	console.log('🎉 All tables initialized');
}
