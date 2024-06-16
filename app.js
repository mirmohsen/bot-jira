const { Telegraf } = require('telegraf');
const axios = require('axios');
require('dotenv').config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

async function createJiraIssue(title, description, attachments) {
	const issueData = {
		fields: {
			project: {
				key: 'KAN',
			},
			summary: title,
			description: description,
			issuetype: {
				name: 'Task',
			},
		},
	};

	const issueResponse = await axios.post(
		`${process.env.JIRA_BASE_URL}/rest/api/2/issue`,
		issueData,
		{
			auth: {
				Username: process.env.JIRA_EMAIL,
				Password: process.env.JIRA_API_TOKEN,
			},
			headers: {
				'Content-Type': 'application/json',
			},
		}
	);

	let issueKey = issueResponse.data.key;

	console.log('issue key ----->', issueKey);

	for (const attachment of attachments) {
		await axios.post(
			`${process.env.JIRA_BASE_URL}/rest/api/3/issue/${issueKey}/attachments/{id}`,
			{
				uri: attachment.url,
			},
			{
				auth: {
					username: process.env.JIRA_EMAIL,
					password: process.env.JIRA_API_TOKEN,
				},
				headers: {
					'X-Atlassian-Token': 'no-check',
				},
			}
		);
	}
	return issueResponse.data;
}

bot.on('channel_post', async (ctx) => {
	console.log('>>>>> Starting bot!');
	console.log(ctx.channelPost.caption);
	const message = ctx.channelPost;
	const text = message.caption;

	if (text && text.includes('#bug')) {
		const title = text.split('\n')[0];
		const description = text;

		let attachments = [];
		if (message.photo) {
			const fileId = message.photo[message.photo.length - 1].file_id;
			const fileUrl = await ctx.telegram.getFileLink(fileId);
			attachments.push({ url: fileUrl.href });
		}

		if (message.video) {
			const fileId = message.video.file_id;

			const fileUrl = await ctx.telegram.getFileLink(fileId);
			console.log('>>>>>', fileUrl.href);
			attachments.push({ url: fileUrl.href });
		}

		await createJiraIssue(title, description, attachments[0].url)
			.then((response) => {
				ctx.reply('Task created in Jira successfully!');
				console.log(response);
			})
			.catch((error) => {
				console.error(error.response);
				ctx.reply('Failed to create task in Jira.');
			});
	}
});

bot.launch();
