// add-recipient-id-column.js
import { db } from './src/config/db.js';

async function addRecipientIdColumn() {
	try {
		await db.execute(`
      ALTER TABLE room_messages 
      ADD COLUMN recipient_id TEXT REFERENCES users(id) ON DELETE CASCADE
    `);
		console.log('✅ recipient_id column added to room_messages table');
	} catch (error) {
		console.error('❌ Error adding column:', error.message);
	}
	process.exit(0);
}

addRecipientIdColumn();
