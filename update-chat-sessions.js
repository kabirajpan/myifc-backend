import { db } from './src/config/db.js';

async function updateChatSessions() {
	try {
		// Add the missing columns
		await db.execute(`
      ALTER TABLE chat_sessions 
      ADD COLUMN user1_logged_out BOOLEAN DEFAULT 0
    `);

		await db.execute(`
      ALTER TABLE chat_sessions 
      ADD COLUMN user2_logged_out BOOLEAN DEFAULT 0
    `);

		console.log('✅ Chat sessions table updated');
	} catch (error) {
		console.error('❌ Error:', error.message);
	}
}

updateChatSessions();
