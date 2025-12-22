import { createClient } from '@libsql/client';
import dotenv from 'dotenv';

dotenv.config();



export const db = createClient({
	url: process.env.DATABASE_URL,
	authToken: process.env.DATABASE_AUTH_TOKEN
})

export async function createUsersTable() {

	await db.execute(`

	CREATE TABLE IF NOT EXIST users (
	id TEXT PRIMARY KEY,
	username TEXT UNIQUE NOT NULL,
	email TEXT
)
`)
}



console.log('✅ Database connected');
