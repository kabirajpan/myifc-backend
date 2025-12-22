import { initDatabase } from './src/config/db.js';

async function init() {
	await initDatabase();
	console.log('✅ Database setup complete');
	process.exit(0);
}

init();
