import { db } from './src/config/db.js';

async function checkDatabase() {
	try {
		// List all tables
		const tables = await db.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table'
      ORDER BY name
    `);

		console.log('📋 Existing tables:');
		tables.rows.forEach(row => {
			console.log(`  - ${row.name}`);
		});

		console.log('\n✅ Total tables:', tables.rows.length);

	} catch (error) {
		console.error('❌ Error:', error);
	}
}

checkDatabase();
