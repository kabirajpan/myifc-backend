import { db } from '../config/db.js';
import { generateId } from '../utils/idGenerator.js';
import { broadcastProjectMessage, broadcastProjectReaction, broadcastProjectPresence, broadcastProjectReactionRemoval } from './websocket.service.js';

// Generate unique invite code
function generateInviteCode() {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let code = '';
	for (let i = 0; i < 12; i++) {
		code += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return code;
}

// Create project (freelancers only)
export async function createProject(creatorId, name, description) {
	// Check if creator is freelancer
	const userResult = await db.execute({
		sql: 'SELECT is_guest, role FROM users WHERE id = ?',
		args: [creatorId]
	});

	if (userResult.rows.length === 0) {
		throw new Error('User not found');
	}

	const user = userResult.rows[0];

	if (user.role !== 'freelancer') {
		throw new Error('Only freelancers can create projects');
	}

	const projectId = generateId();
	const inviteCode = generateInviteCode();
	const now = Date.now();

	await db.execute({
		sql: `INSERT INTO projects (id, name, description, creator_id, invite_code, status, created_at)
              VALUES (?, ?, ?, ?, ?, 'active', ?)`,
		args: [projectId, name, description, creatorId, inviteCode, now]
	});

	// Auto-join creator to project
	await joinProject(projectId, creatorId);

	return {
		id: projectId,
		name,
		description,
		creator_id: creatorId,
		invite_code: inviteCode,
		status: 'active',
		created_at: now,
		invite_url: `${process.env.APP_URL || 'http://localhost:3000'}/join/${inviteCode}`
	};
}

// Get all projects for a freelancer (creator)
export async function getFreelancerProjects(userId) {
	const result = await db.execute({
		sql: `SELECT p.*, 
              u.username as creator_username,
              (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count
              FROM projects p
              JOIN users u ON p.creator_id = u.id
              WHERE p.creator_id = ?
              ORDER BY 
                CASE 
                  WHEN p.status = 'active' THEN 1
                  WHEN p.status = 'completed' THEN 2
                  WHEN p.status = 'archived' THEN 3
                END,
                p.created_at DESC`,
		args: [userId]
	});

	return result.rows;
}

// Get user's joined projects (as member)
export async function getUserJoinedProjects(userId) {
	const result = await db.execute({
		sql: `SELECT p.*, 
              u.username as creator_username,
              (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count,
              1 as has_joined
              FROM projects p
              JOIN users u ON p.creator_id = u.id
              JOIN project_members pm ON p.id = pm.project_id
              WHERE pm.user_id = ? AND p.status = 'active'
              ORDER BY p.created_at DESC`,
		args: [userId]
	});

	return result.rows;
}

// Get project by ID
export async function getProjectById(projectId) {
	const result = await db.execute({
		sql: `SELECT p.*, 
              u.username as creator_username,
              u.name as creator_name,
              u.is_online as creator_online,
              (SELECT COUNT(*) FROM project_members WHERE project_id = p.id) as member_count
              FROM projects p
              JOIN users u ON p.creator_id = u.id
              WHERE p.id = ?`,
		args: [projectId]
	});

	if (result.rows.length === 0) {
		throw new Error('Project not found');
	}

	return result.rows[0];
}

// Get project by invite code
export async function getProjectByInviteCode(inviteCode) {
	const result = await db.execute({
		sql: `SELECT p.*, 
              u.username as creator_username,
              u.name as creator_name
              FROM projects p
              JOIN users u ON p.creator_id = u.id
              WHERE p.invite_code = ? AND p.status = 'active'`,
		args: [inviteCode]
	});

	if (result.rows.length === 0) {
		throw new Error('Project not found or inactive');
	}

	return result.rows[0];
}

// Join project (via invite link)
export async function joinProject(projectId, userId) {
	// Check if project exists and is active
	const project = await getProjectById(projectId);

	if (project.status !== 'active') {
		throw new Error('Project is not active');
	}

	// Check if already a member
	const existing = await db.execute({
		sql: 'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
		args: [projectId, userId]
	});

	if (existing.rows.length > 0) {
		return { message: 'Already in project' };
	}

	const memberId = generateId();
	const now = Date.now();

	await db.execute({
		sql: 'INSERT INTO project_members (id, project_id, user_id, joined_at) VALUES (?, ?, ?, ?)',
		args: [memberId, projectId, userId, now]
	});

	const userResult = await db.execute({
		sql: 'SELECT id, username, name, is_guest, role FROM users WHERE id = ?',
		args: [userId]
	});

	if (userResult.rows.length > 0) {
		const user = userResult.rows[0];

		// Broadcast user joined
		try {
			await broadcastProjectPresence(projectId, user, 'joined');
		} catch (wsError) {
			console.error('WebSocket presence broadcast failed:', wsError);
		}
	}

	return { message: 'Joined project successfully' };
}

// Leave project
export async function leaveProject(projectId, userId) {
	// Check if user is creator (creators can't leave their own projects)
	const project = await getProjectById(projectId);

	if (project.creator_id === userId) {
		throw new Error('Project creator cannot leave. Archive the project instead.');
	}

	// Get user info for broadcasting BEFORE deleting
	const userResult = await db.execute({
		sql: 'SELECT id, username, name, is_guest, role FROM users WHERE id = ?',
		args: [userId]
	});

	// Delete user from project
	await db.execute({
		sql: 'DELETE FROM project_members WHERE project_id = ? AND user_id = ?',
		args: [projectId, userId]
	});

	if (userResult.rows.length > 0) {
		const user = userResult.rows[0];

		// Broadcast user left
		try {
			await broadcastProjectPresence(projectId, user, 'left');
		} catch (wsError) {
			console.error('WebSocket presence broadcast failed:', wsError);
		}
	}

	return { message: 'Left project successfully' };
}

// Send message in project
export async function sendProjectMessage(
	projectId,
	senderId,
	content,
	type = 'text',
	replyToMessageId = null,
	caption = null,
	recipientId = null
) {
	// Check if user is in project
	const member = await db.execute({
		sql: 'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
		args: [projectId, senderId]
	});

	if (member.rows.length === 0) {
		throw new Error('You must join the project to send messages');
	}

	// If recipient specified, set type to 'secret'
	if (recipientId) {
		type = 'secret';
	}

	const messageId = generateId();
	const now = Date.now();

	await db.execute({
		sql: `INSERT INTO project_messages 
          (id, project_id, sender_id, recipient_id, content, type, created_at, is_read, caption, reply_to_message_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [messageId, projectId, senderId, recipientId, content, type, now, 0, caption, replyToMessageId]
	});

	// Get sender info
	const senderResult = await db.execute({
		sql: 'SELECT username, name, role FROM users WHERE id = ?',
		args: [senderId]
	});

	// Get recipient info if secret message
	let recipientUsername = null;
	let recipientName = null;

	if (recipientId) {
		const recipientResult = await db.execute({
			sql: 'SELECT username, name, role FROM users WHERE id = ?',
			args: [recipientId]
		});
		recipientUsername = recipientResult.rows[0]?.username;
		recipientName = recipientResult.rows[0]?.name;
	}

	// Get reply message data if reply exists
	let replyData = null;
	if (replyToMessageId) {
		const replyResult = await db.execute({
			sql: `SELECT pm.content, pm.type, pm.caption, pm.created_at, u.username, u.name
            FROM project_messages pm
            JOIN users u ON pm.sender_id = u.id
            WHERE pm.id = ?`,
			args: [replyToMessageId]
		});
		replyData = replyResult.rows[0];
	}

	try {
		await broadcastProjectMessage(projectId, {
			id: messageId,
			project_id: projectId,
			sender_id: senderId,
			recipient_id: recipientId,
			sender_username: senderResult.rows[0]?.username,
			sender_name: senderResult.rows[0]?.name,
			sender_role: senderResult.rows[0]?.role,
			recipient_username: recipientUsername,
			recipient_name: recipientName,
			content,
			type,
			caption,
			reply_to_message_id: replyToMessageId,
			...(replyData && {
				reply_to_message_content: replyData.content,
				reply_to_message_sender: replyData.username,
				reply_to_message_sender_name: replyData.name,
				reply_to_message_time: replyData.created_at,
				reply_to_message_type: replyData.type,
				reply_to_message_caption: replyData.caption
			}),
			created_at: now
		}, senderId);
	} catch (wsError) {
		console.error('WebSocket broadcast failed:', wsError);
	}

	return {
		id: messageId,
		project_id: projectId,
		sender_id: senderId,
		recipient_id: recipientId,
		sender_username: senderResult.rows[0]?.username,
		sender_name: senderResult.rows[0]?.name,
		sender_role: senderResult.rows[0]?.role,
		recipient_username: recipientUsername,
		recipient_name: recipientName,
		content,
		type,
		caption,
		reply_to_message_id: replyToMessageId,
		...(replyData && {
			reply_to_message_content: replyData.content,
			reply_to_message_sender: replyData.username,
			reply_to_message_sender_name: replyData.name,
			reply_to_message_time: replyData.created_at,
			reply_to_message_type: replyData.type,
			reply_to_message_caption: replyData.caption
		}),
		created_at: now
	};
}

// Get project messages (filter secret messages based on user)
export async function getProjectMessages(projectId, userId, limit = 100, offset = 0) {
	const result = await db.execute({
		sql: `SELECT pm.*, 
          u1.username as sender_username,
          u1.name as sender_name,
          u1.role as sender_role,
          u2.username as recipient_username,
          u2.name as recipient_name,
          u2.role as recipient_role,
          pm2.content as reply_to_message_content,
          pm2.type as reply_to_message_type,
          pm2.caption as reply_to_message_caption,
          pm2.created_at as reply_to_message_time,
          u3.username as reply_to_message_sender,
          u3.name as reply_to_message_sender_name
          FROM project_messages pm
          JOIN users u1 ON pm.sender_id = u1.id
          LEFT JOIN users u2 ON pm.recipient_id = u2.id
          LEFT JOIN project_messages pm2 ON pm.reply_to_message_id = pm2.id
          LEFT JOIN users u3 ON pm2.sender_id = u3.id
          WHERE pm.project_id = ?
          ORDER BY pm.created_at DESC
          LIMIT ? OFFSET ?`,
		args: [projectId, limit, offset]
	});

	// Filter messages - only show secret messages to sender and recipient
	const filteredMessages = result.rows.filter(msg => {
		if (msg.type === 'secret') {
			return msg.sender_id === userId || msg.recipient_id === userId;
		}
		return true;
	});

	// Batch fetch reactions
	const messageIds = filteredMessages.map(m => m.id);
	let allReactions = [];

	if (messageIds.length > 0) {
		const placeholders = messageIds.map(() => '?').join(',');
		const reactionsResult = await db.execute({
			sql: `SELECT pmr.*, u.username, u.name
          FROM project_message_reactions pmr
          JOIN users u ON pmr.user_id = u.id
          WHERE pmr.message_id IN (${placeholders})
          ORDER BY pmr.created_at ASC`,
			args: messageIds
		});
		allReactions = reactionsResult.rows || [];
	}

	// Group reactions by message_id
	const reactionsByMessage = {};
	allReactions.forEach(reaction => {
		if (!reactionsByMessage[reaction.message_id]) {
			reactionsByMessage[reaction.message_id] = [];
		}
		reactionsByMessage[reaction.message_id].push(reaction);
	});

	// Process messages with reactions
	const messagesWithReactions = filteredMessages.map(msg => ({
		...msg,
		reactions: reactionsByMessage[msg.id] || []
	}));

	return messagesWithReactions.reverse();
}

// Get new messages after timestamp (for cache updates)
export async function getNewMessages(projectId, userId, afterTimestamp) {
	const result = await db.execute({
		sql: `SELECT pm.*, 
          u1.username as sender_username,
          u1.name as sender_name,
          u1.role as sender_role,
          u2.username as recipient_username,
          u2.name as recipient_name,
          pm2.content as reply_to_message_content,
          pm2.type as reply_to_message_type,
          pm2.caption as reply_to_message_caption,
          pm2.created_at as reply_to_message_time,
          u3.username as reply_to_message_sender,
          u3.name as reply_to_message_sender_name
          FROM project_messages pm
          JOIN users u1 ON pm.sender_id = u1.id
          LEFT JOIN users u2 ON pm.recipient_id = u2.id
          LEFT JOIN project_messages pm2 ON pm.reply_to_message_id = pm2.id
          LEFT JOIN users u3 ON pm2.sender_id = u3.id
          WHERE pm.project_id = ? AND pm.created_at > ?
          ORDER BY pm.created_at ASC`,
		args: [projectId, afterTimestamp]
	});

	// Filter secret messages
	const filteredMessages = result.rows.filter(msg => {
		if (msg.type === 'secret') {
			return msg.sender_id === userId || msg.recipient_id === userId;
		}
		return true;
	});

	// Fetch reactions
	const messagesWithReactions = await Promise.all(
		filteredMessages.map(async (msg) => {
			const reactionsResult = await db.execute({
				sql: `SELECT pmr.*, u.username, u.name
				      FROM project_message_reactions pmr
				      JOIN users u ON pmr.user_id = u.id
				      WHERE pmr.message_id = ?
				      ORDER BY pmr.created_at ASC`,
				args: [msg.id]
			});

			return {
				...msg,
				reactions: reactionsResult.rows || []
			};
		})
	);

	return messagesWithReactions;
}

// Get message count
export async function getMessageCount(projectId) {
	const result = await db.execute({
		sql: 'SELECT COUNT(*) as count FROM project_messages WHERE project_id = ?',
		args: [projectId]
	});

	return result.rows[0]?.count || 0;
}

// Get project members
export async function getProjectMembers(projectId) {
	const result = await db.execute({
		sql: `SELECT pm.*, u.username, u.name, u.role, u.is_online, u.is_guest
              FROM project_members pm
              JOIN users u ON pm.user_id = u.id
              WHERE pm.project_id = ?
              ORDER BY pm.joined_at DESC`,
		args: [projectId]
	});

	return result.rows;
}

// Complete project (creator only)
export async function completeProject(projectId, userId) {
	const project = await getProjectById(projectId);

	if (project.creator_id !== userId) {
		throw new Error('Only project creator can complete the project');
	}

	if (project.status !== 'active') {
		throw new Error('Project is not active');
	}

	const now = Date.now();

	await db.execute({
		sql: 'UPDATE projects SET status = ?, completed_at = ? WHERE id = ?',
		args: ['completed', now, projectId]
	});

	return {
		message: 'Project marked as completed. Data will be archived in 30 days.',
		project: await getProjectById(projectId)
	};
}

// Archive project immediately (creator only)
export async function archiveProject(projectId, userId) {
	const project = await getProjectById(projectId);

	if (project.creator_id !== userId) {
		throw new Error('Only project creator can archive the project');
	}

	const now = Date.now();

	// Delete all project data
	await deleteProjectData(projectId);

	await db.execute({
		sql: 'UPDATE projects SET status = ?, archived_at = ? WHERE id = ?',
		args: ['archived', now, projectId]
	});

	return { message: 'Project archived successfully' };
}

// Delete project data helper
async function deleteProjectData(projectId) {
	// Delete reactions
	await db.execute({
		sql: 'DELETE FROM project_message_reactions WHERE message_id IN (SELECT id FROM project_messages WHERE project_id = ?)',
		args: [projectId]
	});

	// Delete messages
	await db.execute({
		sql: 'DELETE FROM project_messages WHERE project_id = ?',
		args: [projectId]
	});

	// Delete members
	await db.execute({
		sql: 'DELETE FROM project_members WHERE project_id = ?',
		args: [projectId]
	});
}

// Delete project completely (creator only)
export async function deleteProject(projectId, userId) {
	const project = await getProjectById(projectId);

	const userResult = await db.execute({
		sql: 'SELECT role FROM users WHERE id = ?',
		args: [userId]
	});

	const isAdmin = userResult.rows[0]?.role === 'admin';
	const isCreator = project.creator_id === userId;

	if (!isAdmin && !isCreator) {
		throw new Error('Only project creator or admin can delete this project');
	}

	await db.execute({
		sql: 'DELETE FROM projects WHERE id = ?',
		args: [projectId]
	});

	return { message: 'Project deleted successfully' };
}

// Mark user projects for deletion (when guest logs out)
export async function markUserProjectsForDeletion(userId) {
	// For guests, remove them from all projects
	const user = await db.execute({
		sql: 'SELECT role, is_guest FROM users WHERE id = ?',
		args: [userId]
	});

	if (user.rows[0]?.is_guest) {
		await db.execute({
			sql: 'DELETE FROM project_members WHERE user_id = ?',
			args: [userId]
		});
	}

	return { message: 'User removed from projects' };
}

// React to project message
export async function reactToProjectMessage(messageId, userId, emoji) {
	const messageCheck = await db.execute({
		sql: `SELECT pm.project_id, pm.sender_id, pm.recipient_id, pm.type
          FROM project_messages pm
          WHERE pm.id = ?`,
		args: [messageId]
	});

	if (messageCheck.rows.length === 0) {
		throw new Error('Message not found');
	}

	const message = messageCheck.rows[0];

	// Check if user is in project
	const memberCheck = await db.execute({
		sql: 'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?',
		args: [message.project_id, userId]
	});

	if (memberCheck.rows.length === 0) {
		throw new Error('You must be in the project to react to messages');
	}

	// Check if user can see this message (for secret messages)
	if (message.type === 'secret') {
		if (message.sender_id !== userId && message.recipient_id !== userId) {
			throw new Error('You cannot react to this message');
		}
	}

	const reactionId = generateId();
	const now = Date.now();

	await db.execute({
		sql: `INSERT INTO project_message_reactions (id, message_id, user_id, emoji, created_at)
          VALUES (?, ?, ?, ?, ?)`,
		args: [reactionId, messageId, userId, emoji, now]
	});

	const userResult = await db.execute({
		sql: 'SELECT username, name FROM users WHERE id = ?',
		args: [userId]
	});

	try {
		await broadcastProjectReaction(message.project_id, {
			id: reactionId,
			message_id: messageId,
			user_id: userId,
			username: userResult.rows[0]?.username,
			name: userResult.rows[0]?.name,
			emoji,
			created_at: now
		}, messageId);
	} catch (wsError) {
		console.error('WebSocket reaction broadcast failed:', wsError);
	}

	return {
		id: reactionId,
		message_id: messageId,
		user_id: userId,
		username: userResult.rows[0]?.username,
		name: userResult.rows[0]?.name,
		emoji,
		created_at: now
	};
}

// Get reactions for project message
export async function getProjectMessageReactions(messageId) {
	const result = await db.execute({
		sql: `SELECT pmr.*, u.username, u.name
          FROM project_message_reactions pmr
          JOIN users u ON pmr.user_id = u.id
          WHERE pmr.message_id = ?
          ORDER BY pmr.created_at DESC`,
		args: [messageId]
	});

	return result.rows;
}

// Remove reaction from project message
export async function removeProjectMessageReaction(reactionId, userId) {
	const reactionCheck = await db.execute({
		sql: `SELECT pmr.message_id, pm.project_id 
          FROM project_message_reactions pmr
          JOIN project_messages pm ON pmr.message_id = pm.id
          WHERE pmr.id = ? AND pmr.user_id = ?`,
		args: [reactionId, userId]
	});

	if (reactionCheck.rows.length === 0) {
		throw new Error('Reaction not found or you do not have permission to remove it');
	}

	const { message_id, project_id } = reactionCheck.rows[0];

	await db.execute({
		sql: `DELETE FROM project_message_reactions 
          WHERE id = ? AND user_id = ?`,
		args: [reactionId, userId]
	});

	try {
		await broadcastProjectReactionRemoval(project_id, reactionId, message_id);
	} catch (wsError) {
		console.error('WebSocket removal broadcast failed:', wsError);
	}

	return { message: 'Reaction removed' };
}
