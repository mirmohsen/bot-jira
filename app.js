const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
require('dotenv').config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.on('message', async (ctx) => {
	const message = ctx.message.text || ctx.message.caption;
	const bugRegex = /#bug/i;

	if (message && bugRegex.test(message)) {
		const title = message.split('\n')[0];
		const description = message;

		let fileId = null;
		let tempFilePath = null;

		if (ctx.message.photo) {
			fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
		} else if (ctx.message.document) {
			fileId =
				ctx.message.document.file_id[ctx.message.document.length - 1].file_id;
		} else if (ctx.message.video) {
			fileId = ctx.message.video.file_id[ctx.message.video.length - 1].file_id;
		}

		if (fileId) {
			tempFilePath = await handleFile(ctx, fileId);
		}

		const issueKey = await createJiraIssue(ctx, title, description);

		if (issueKey && tempFilePath) {
			await attachFilesToJiraIssue(issueKey, tempFilePath);
			clearFile(tempFilePath);
		}
	}
});

async function handleFile(ctx, fileId) {
	const res = await axios.get(
		`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
	);
	const filePath = res.data.result.file_path;

	const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
	const fileResponse = await axios.get(fileUrl, {
		responseType: 'arraybuffer',
	});

	const fileSizeBytes = fileResponse.data.length;

	if (fileSizeBytes > 1.5e7) {
		ctx.reply('The file is larger than 15 MB. Please reduce the file size.');
		return null;
	}

	const fileName = path.basename(filePath);
	const tempFilePath = path.resolve(__dirname, 'temp', fileName);

	fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });

	fs.writeFileSync(tempFilePath, fileResponse.data);

	return tempFilePath;
}

async function createJiraIssue(ctx, title, description) {
	let data = JSON.stringify({
		fields: {
			project: {
				key: 'KAN',
			},
			summary: title,
			issuetype: {
				name: 'Task',
			},
			description: {
				content: [
					{
						content: [
							{
								text: description,
								type: 'text',
							},
						],
						type: 'paragraph',
					},
				],
				type: 'doc',
				version: 1,
			},
		},
	});

	let config = {
		method: 'post',
		maxBodyLength: Infinity,
		url: `${process.env.JIRA_URL}/rest/api/3/issue`,
		headers: {
			'Content-Type': 'application/json',
			Authorization: process.env.JIRA_API_TOKEN,
		},
		data: data,
	};

	try {
		const response = await axios.request(config);
		ctx.reply(
			`Task created in Jira successfully!\nissue key = ${response.data.key}, issue id = ${response.data.id}`
		);
		return response.data.key;
	} catch (error) {
		console.error('Failed to create task in Jira:', error);
		ctx.reply('Failed to create task in Jira.');
		return null;
	}
}

async function attachFilesToJiraIssue(issueKey, tempFilePath) {
	if (!tempFilePath) {
		console.log('No file path provided.');
		return;
	}

	try {
		const formData = new FormData();
		formData.append('file', fs.createReadStream(tempFilePath));

		const config = {
			method: 'post',
			maxBodyLength: Infinity,
			url: `${process.env.JIRA_URL}/rest/api/3/issue/${issueKey}/attachments`,
			headers: {
				'X-Atlassian-Token': 'no-check',
				Authorization: process.env.JIRA_API_TOKEN,
				...formData.getHeaders(),
			},
			data: formData,
		};

		const response = await axios.request(config);
		console.log(`File attached successfully: ${tempFilePath}`);
	} catch (error) {
		console.error('Error attaching file to Jira issue:', error);
	}
}

function clearFile(filePath) {
	fs.unlink(filePath, (err) => {
		if (err) {
			console.error(`Error clearing file ${filePath}:`, err);
		} else {
			console.log(`Cleared temporary file: ${filePath}`);
		}
	});
}

bot.launch();
