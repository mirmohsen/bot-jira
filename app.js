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

		if (ctx.message.photo) {
			const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
			await handleFile(ctx, fileId);
		} else if (ctx.message.document) {
			const fileId = ctx.message.document.file_id;
			await handleFile(ctx, fileId);
		} else if (ctx.message.video) {
			const fileId = ctx.message.video.file_id;
			await handleFile(ctx, fileId);
		}

		const filePath = fileId ? await handleFile(ctx, fileId) : null;

		const issueKey = await createJiraIssue(ctx, title, description);

		if (issueKey) {
			await attachFilesToJiraIssue(issueKey, filePath);

			if (filePath) {
				clearDirectory(path.dirname(filePath));
			}
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
		return;
	}

	const fileName = path.basename(filePath);
	const public = path.resolve(__dirname, 'public', fileName);

	fs.mkdirSync(path.dirname(public), { recursive: true });

	fs.writeFileSync(public, fileResponse.data);

	return public;
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

	axios
		.request(config)
		.then((response) => {
			ctx.reply(
				`Task created in Jira successfully!\nissue key = ${response.data.key}, issue id = ${response.data.id}`
			);
		})
		.catch((error) => {
			console.error(error);
			ctx.reply('Failed to create task in Jira.');
		});
}

async function attachFilesToJiraIssue(issueKey, filePath) {
	if (!filePath) {
		return;
	}

	try {
		const directoryPath = path.dirname(filePath);

		fs.readdir(directoryPath, async (err, files) => {
			if (err) {
				console.error('Error reading directory:', err);
				return;
			}

			for (const file of files) {
				const fullPath = path.join(directoryPath, file);
				const data = new FormData();
				data.append('file', fs.createReadStream(fullPath));

				let config = {
					method: 'post',
					maxBodyLength: 'Infinity',
					url: `${process.env.JIRA_URL}/rest/api/3/issue/${issueKey}/attachments`,
					headers: {
						'X-Atlassian-Token': 'no-check',
						Authorization: process.env.JIRA_API_TOKEN,
						...data.getHeaders(),
					},
					data: data,
				};

				await axios
					.request(config)
					.then((response) => {
						console.log(JSON.stringify(response.data));
					})
					.catch((error) => {
						console.log(error);
					});

				console.log(`File attached: ${file}`);
			}
		});
	} catch (error) {
		console.error('Error attaching files to Jira issue:', error);
	}
}

function clearDirectory(directory) {
	fs.readdir(directory, (err, files) => {
		if (err) throw err;

		for (const file of files) {
			fs.unlink(path.join(directory, file), (err) => {
				if (err) throw err;
			});
		}
	});
}

bot.launch();
