// fix-room-messages-type-constraint.js
import { db } from './src/config/db.js';

async function fixTypeConstraint() {
	try {
		// 0. First, fix any NULL created_at values
		console.log('Fixing NULL created_at values...');
		await db.execute(`
      UPDATE room_messages 
      SET created_at = ${Date.now()} 
      WHERE created_at IS NULL
    `);

		// 1. Create new table with correct constraint
		console.log('Creating new table...');
		await db.execute(`
      CREATE TABLE room_messages_new (
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

		// 2. Copy existing data
		console.log('Copying data...');
		await db.execute(`
      INSERT INTO room_messages_new 
      SELECT * FROM room_messages
    `);

		// 3. Drop old table
		console.log('Dropping old table...');
		await db.execute(`DROP TABLE room_messages`);

		// 4. Rename new table
		console.log('Renaming table...');
		await db.execute(`ALTER TABLE room_messages_new RENAME TO room_messages`);

		console.log('✅ room_messages table updated with secret type support');
	} catch (error) {
		console.error('❌ Error:', error.message);
	}
	process.exit(0);
}

fixTypeConstraint();
