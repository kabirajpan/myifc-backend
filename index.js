import app from './src/app.js';
import { initDatabase } from './src/config/db.js';
import { verifyToken } from './src/utils/jwt.js';
import { addConnection, removeConnection } from './src/services/websocket.service.js';

// Initialize database
await initDatabase();

const port = process.env.PORT || 8000;

// Start Bun server with WebSocket support
Bun.serve({
	port: port,

	fetch(req, server) {
		// Check if it's a WebSocket upgrade request
		const url = new URL(req.url);

		if (url.pathname === '/ws') {
			const upgraded = server.upgrade(req);
			if (upgraded) {
				return undefined; // Connection upgraded to WebSocket
			}
			return new Response('WebSocket upgrade failed', { status: 400 });
		}

		// Handle regular HTTP requests through Hono
		return app.fetch(req);
	},

	websocket: {
		open(ws) {
			console.log('🔌 New WebSocket connection');
			ws.data = { authenticated: false, userId: null };
		},

		message(ws, message) {
			try {
				const data = JSON.parse(message);

				// Handle authentication
				if (data.type === 'auth') {
					try {
						const decoded = verifyToken(data.token);
						ws.data.userId = decoded.userId;
						ws.data.authenticated = true;

						// Store connection
						addConnection(decoded.userId, ws);

						// Send success response
						ws.send(JSON.stringify({
							type: 'auth_success',
							message: 'WebSocket authenticated successfully'
						}));
					} catch (err) {
						console.error('WebSocket auth error:', err.message);
						ws.send(JSON.stringify({
							type: 'auth_error',
							message: 'Invalid token'
						}));
						ws.close();
					}
				}

				// Handle ping/pong for connection keep-alive
				if (data.type === 'ping') {
					ws.send(JSON.stringify({ type: 'pong' }));
				}
			} catch (err) {
				console.error('WebSocket message error:', err);
			}
		},

		close(ws) {
			if (ws.data.userId) {
				removeConnection(ws.data.userId);
			}
		},

		error(ws, error) {
			console.error('WebSocket error:', error);
		}
	}
});

console.log(`🚀 Server running on http://localhost:${port}`);
console.log(`📡 API: http://localhost:${port}/api`);
console.log(`🔌 WebSocket: ws://localhost:${port}/ws`);
