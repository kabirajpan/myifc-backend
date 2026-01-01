import { Hono } from 'hono';
import {
	createProject,
	getFreelancerProjects,
	getUserJoinedProjects,
	getProjectById,
	getProjectByInviteCode,
	joinProject,
	leaveProject,
	sendProjectMessage,
	getProjectMessages,
	getNewMessages,
	getMessageCount,
	getProjectMembers,
	completeProject,
	archiveProject,
	deleteProject,
	reactToProjectMessage,
	getProjectMessageReactions,
	removeProjectMessageReaction
} from '../services/project.service.js';
import { authMiddleware, requireFreelancer, requireProjectAccess, requireProjectCreator, authOrGuestWithInvite } from '../middleware/auth.js';

const projects = new Hono();

// Public endpoint - Join project via invite code (no auth required initially)
projects.get('/join/:inviteCode', async (c) => {
	try {
		const inviteCode = c.req.param('inviteCode');
		const project = await getProjectByInviteCode(inviteCode);

		return c.json({
			project: {
				id: project.id,
				name: project.name,
				description: project.description,
				creator_name: project.creator_name,
				invite_code: project.invite_code
			}
		});
	} catch (error) {
		return c.json({ error: error.message }, 404);
	}
});

// Join project via invite code (with guest user creation)
projects.post('/join/:inviteCode', async (c) => {
	try {
		const inviteCode = c.req.param('inviteCode');
		const { name, guest_id } = await c.req.json();

		if (!name && !guest_id) {
			return c.json({ error: 'Name or guest_id is required' }, 400);
		}

		// Get project
		const project = await getProjectByInviteCode(inviteCode);

		// If guest_id provided, use it; otherwise create new guest
		let userId = guest_id;

		if (!userId) {
			// Create guest user
			const { createGuestUser } = await import('../services/user.service.js');
			const guestUser = await createGuestUser({ name, username: name });
			userId = guestUser.id;
		}

		// Join project
		await joinProject(project.id, userId);

		// Generate token for guest
		const { generateToken } = await import('../utils/jwt.js');
		const token = generateToken({ userId, role: 'guest', projectId: project.id });

		return c.json({
			message: 'Joined project successfully',
			project: {
				id: project.id,
				name: project.name,
				description: project.description
			},
			user_id: userId,
			token
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// All other routes require authentication
projects.use('/*', authMiddleware);

// Create project (freelancers only)
projects.post('/', requireFreelancer, async (c) => {
	try {
		const user = c.get('user');
		const { name, description } = await c.req.json();

		if (!name) {
			return c.json({ error: 'Project name is required' }, 400);
		}

		const project = await createProject(user.id, name, description);

		return c.json({
			message: 'Project created successfully',
			project
		}, 201);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get all projects for current user
projects.get('/', async (c) => {
	try {
		const user = c.get('user');

		let projectsList = [];

		// If freelancer, get their created projects
		if (user.role === 'freelancer') {
			projectsList = await getFreelancerProjects(user.id);
		} else {
			// If client/guest, get projects they've joined
			projectsList = await getUserJoinedProjects(user.id);
		}

		return c.json({
			count: projectsList.length,
			projects: projectsList
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get project details (requires project access)
projects.get('/:projectId', requireProjectAccess, async (c) => {
	try {
		const project = c.get('project'); // Set by requireProjectAccess middleware
		const isCreator = c.get('isProjectCreator');

		return c.json({
			project,
			is_creator: isCreator
		});
	} catch (error) {
		return c.json({ error: error.message }, 404);
	}
});

// Generate new invite link (creator only)
projects.post('/:projectId/invite', requireProjectCreator, async (c) => {
	try {
		const project = c.get('project');
		const inviteUrl = `${process.env.APP_URL || 'http://localhost:3000'}/join/${project.invite_code}`;

		return c.json({
			invite_code: project.invite_code,
			invite_url: inviteUrl
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Leave project
projects.post('/:projectId/leave', requireProjectAccess, async (c) => {
	try {
		const user = c.get('user');
		const projectId = c.req.param('projectId');

		const result = await leaveProject(projectId, user.id);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Complete project (creator only)
projects.post('/:projectId/complete', requireProjectCreator, async (c) => {
	try {
		const user = c.get('user');
		const projectId = c.req.param('projectId');

		const result = await completeProject(projectId, user.id);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Archive project (creator only)
projects.post('/:projectId/archive', requireProjectCreator, async (c) => {
	try {
		const user = c.get('user');
		const projectId = c.req.param('projectId');

		const result = await archiveProject(projectId, user.id);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Send message in project
projects.post('/:projectId/messages', requireProjectAccess, async (c) => {
	try {
		const user = c.get('user');
		const projectId = c.req.param('projectId');
		const {
			content,
			type = 'text',
			reply_to,
			caption,
			secret_to
		} = await c.req.json();

		if (!content) {
			return c.json({ error: 'Message content is required' }, 400);
		}

		const message = await sendProjectMessage(
			projectId,
			user.id,
			content,
			type,
			reply_to,
			caption,
			secret_to
		);

		return c.json({
			message: 'Message sent',
			data: message
		}, 201);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get message count for project
projects.get('/:projectId/messages/count', requireProjectAccess, async (c) => {
	try {
		const projectId = c.req.param('projectId');
		const count = await getMessageCount(projectId);
		return c.json({ count });
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get project messages
projects.get('/:projectId/messages', requireProjectAccess, async (c) => {
	try {
		const user = c.get('user');
		const projectId = c.req.param('projectId');
		const limit = parseInt(c.req.query('limit') || '100');
		const offset = parseInt(c.req.query('offset') || '0');
		const afterTimestamp = c.req.query('after_timestamp');

		let messages;

		if (afterTimestamp) {
			const timestamp = parseInt(afterTimestamp);
			messages = await getNewMessages(projectId, user.id, timestamp);
		} else {
			messages = await getProjectMessages(projectId, user.id, limit, offset);
		}

		return c.json({
			count: messages.length,
			messages
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get project members
projects.get('/:projectId/members', requireProjectAccess, async (c) => {
	try {
		const projectId = c.req.param('projectId');
		const members = await getProjectMembers(projectId);

		return c.json({
			count: members.length,
			members
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// React to project message
projects.post('/:projectId/messages/:messageId/react', requireProjectAccess, async (c) => {
	try {
		const user = c.get('user');
		const messageId = c.req.param('messageId');
		const { emoji } = await c.req.json();

		if (!emoji) {
			return c.json({ error: 'Emoji is required' }, 400);
		}

		const reaction = await reactToProjectMessage(messageId, user.id, emoji);

		return c.json({
			message: 'Reaction added',
			data: reaction
		}, 201);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Get reactions for project message
projects.get('/:projectId/messages/:messageId/reactions', requireProjectAccess, async (c) => {
	try {
		const messageId = c.req.param('messageId');
		const reactions = await getProjectMessageReactions(messageId);

		return c.json({
			count: reactions.length,
			reactions
		});
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Remove reaction from project message
projects.delete('/:projectId/reactions/:reactionId', requireProjectAccess, async (c) => {
	try {
		const user = c.get('user');
		const reactionId = c.req.param('reactionId');

		const result = await removeProjectMessageReaction(reactionId, user.id);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

// Delete project (creator only)
projects.delete('/:projectId', requireProjectCreator, async (c) => {
	try {
		const user = c.get('user');
		const projectId = c.req.param('projectId');

		const result = await deleteProject(projectId, user.id);
		return c.json(result);
	} catch (error) {
		return c.json({ error: error.message }, 400);
	}
});

export default projects;
