import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import friends from './routes/friends.js';
import projects from './routes/projects.js';  // UPDATED: Changed from rooms to projects
import admin from './routes/admin.js';
import media from './routes/media.js';

const app = new Hono();

// CORS middleware
app.use('/*', cors({
	origin: '*',  // Allow all origins (for development only!)
	credentials: true,
	allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
	allowHeaders: ['Content-Type', 'Authorization']
}));

// Health check
app.get('/', (c) => {
	return c.json({
		status: 'healthy',
		message: 'Freelancer Chat API',  // UPDATED: Changed from Anonymous Chat API
		timestamp: new Date().toISOString(),
		version: '2.0.0'  // NEW: Version indicator
	});
});

// Routes
app.route('/api/auth', authRoutes);
app.route('/api/chat', chatRoutes);
app.route('/api/friends', friends);
app.route('/api/projects', projects);  // UPDATED: Changed from /api/rooms to /api/projects
app.route('/api/admin', admin);
app.route('/api/media', media);

export default app;
