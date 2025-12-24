import { Hono } from 'hono';
import { cors } from 'hono/cors';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import friends from './routes/friends.js';
import rooms from './routes/rooms.js';
import admin from './routes/admin.js';
import media from './routes/media.js';  // NEW: Media routes

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
		message: 'Anonymous Chat API',
		timestamp: new Date().toISOString()
	});
});

// Routes
app.route('/api/auth', authRoutes);
app.route('/api/chat', chatRoutes);
app.route('/api/friends', friends);
app.route('/api/rooms', rooms);
app.route('/api/admin', admin);
app.route('/api/media', media);  // NEW: Media upload routes

export default app;
