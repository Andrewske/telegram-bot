import { Telegraf } from 'telegraf';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

import { getUserState, upsertUserState, updateNextCheckin } from './lib/db.js';
import { processUserMessage, generateCheckinMessage } from './lib/llm.js';
import { appendToDaily, uploadPhoto, generatePhotoMarkdown } from './lib/drive.js';
import { sendMessage, downloadPhoto, isAllowedUser, generatePhotoFilename } from './lib/telegram.js';
import { startScheduler } from './scheduler.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN environment variable is required');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Middleware to check allowed users
bot.use(async (ctx, next) => {
  if (!ctx.from || !isAllowedUser(ctx.from.id)) {
    console.log(`Unauthorized access attempt from user ${ctx.from?.id}`);
    return;
  }
  return next();
});

// Start command
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  const timezone = process.env.TZ_DEFAULT || 'America/Los_Angeles';

  // Set next check-in to 1 hour from now
  const nextCheckin = dayjs().add(1, 'hour').toDate();
  await upsertUserState(userId, nextCheckin, timezone);

  await ctx.reply(
    "Welcome to your Personal Historian! 📝\n\n" +
    "I'm here to help you document your daily activities and experiences. " +
    "Just send me messages about what you're doing, and I'll keep track of everything in your daily notes.\n\n" +
    "You can send me:\n" +
    "• Text messages about your activities\n" +
    "• Photos with captions\n" +
    "• Work updates, personal moments, anything!\n\n" +
    "I'll check in with you periodically to see how things are going. Let's start documenting your life! 🚀"
  );
});

// Handle text messages
bot.on('text', async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const userState = await getUserState(userId);
    const timezone = userState?.timezone || process.env.TZ_DEFAULT || 'America/Los_Angeles';
    const message = ctx.message.text;

    console.log(`Processing message from ${userId}: ${message.slice(0, 100)}...`);

    // Process message with LLM
    const llmResponse = await processUserMessage(message, false);

    // Save to daily file
    const today = dayjs().tz(timezone).format('YYYY-MM-DD');
    await appendToDaily(today, `${llmResponse.activity_summary}`, timezone);

    // Schedule next check-in
    const nextCheckin = dayjs().add(llmResponse.next_checkin_minutes, 'minute').toDate();
    await updateNextCheckin(userId, nextCheckin);

    // Reply to user
    await ctx.reply(llmResponse.response_text);

    console.log(`Scheduled next check-in for ${userId} at ${nextCheckin.toISOString()}`);
  } catch (error) {
    console.error('Error processing text message:', error);
    await ctx.reply("Sorry, I had trouble processing that. Let me try again in a moment.");
  }
});

// Handle photos
bot.on('photo', async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const userState = await getUserState(userId);
    const timezone = userState?.timezone || process.env.TZ_DEFAULT || 'America/Los_Angeles';
    const caption = ctx.message.caption || 'Photo shared';

    console.log(`Processing photo from ${userId} with caption: ${caption}`);

    // Get the highest resolution photo
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];

    // Download photo from Telegram
    const photoBuffer = await downloadPhoto(photo.file_id);

    // Generate filename and upload to Drive
    const filename = generatePhotoFilename(ctx.from.id, new Date());
    await uploadPhoto(photoBuffer, filename);

    // Process caption with LLM
    const llmResponse = await processUserMessage(caption, true);

    // Generate markdown content with photo
    const photoMarkdown = generatePhotoMarkdown(filename, caption);
    const fullContent = `${photoMarkdown}\n${llmResponse.activity_summary}`;

    // Save to daily file
    const today = dayjs().tz(timezone).format('YYYY-MM-DD');
    await appendToDaily(today, fullContent, timezone);

    // Schedule next check-in
    const nextCheckin = dayjs().add(llmResponse.next_checkin_minutes, 'minute').toDate();
    await updateNextCheckin(userId, nextCheckin);

    // Reply to user
    await ctx.reply(llmResponse.response_text);

    console.log(`Photo processed and saved for ${userId}`);
  } catch (error) {
    console.error('Error processing photo:', error);
    await ctx.reply("I received your photo but had trouble processing it. I'll try to check back later!");
  }
});

// Handle errors
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
});

// Start the bot
async function startBot() {
  console.log('Starting Personal Historian Bot...');
  console.log('Environment check:', {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    BOT_TOKEN: process.env.BOT_TOKEN ? 'Set' : 'Missing',
    DATABASE_URL: process.env.DATABASE_URL ? 'Set' : 'Missing',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'Set' : 'Missing',
  });

  // Start the scheduler for check-ins
  startScheduler();

  if (process.env.NODE_ENV === 'production') {
    // Production: use webhooks
    const webhookUrl = `${process.env.RAILWAY_STATIC_URL || 'https://your-app.railway.app'}/webhook`;
    console.log(`Webhook URL will be: ${webhookUrl}`);
    console.log(`Note: Set webhook manually with: curl -X POST "https://api.telegram.org/bot{BOT_TOKEN}/setWebhook" -d '{"url": "${webhookUrl}"}'`);

    // Don't set webhook automatically - do it manually after deployment

    // Start webhook server with manual handling
    const app = {
      fetch: async (request: Request) => {
        const url = new URL(request.url);

        if (url.pathname === '/webhook' && request.method === 'POST') {
          try {
            const body = await request.text();
            const update = JSON.parse(body);

            // Handle the update manually
            await bot.handleUpdate(update);

            return new Response('OK', { status: 200 });
          } catch (error) {
            console.error('Webhook error:', error);
            return new Response('Error processing webhook', { status: 500 });
          }
        }

        if (url.pathname === '/health') {
          return new Response('OK', { status: 200 });
        }

        return new Response('Not Found', { status: 404 });
      },
    };

    console.log(`Bot starting on port ${PORT} with webhooks`);
    console.log(`Health check available at: http://localhost:${PORT}/health`);

    Bun.serve({
      port: parseInt(PORT.toString()),
      hostname: "0.0.0.0", // Important for Railway
      fetch: app.fetch,
    });
  } else {
    // Development: use polling
    console.log('Starting bot in polling mode for development...');
    await bot.launch();
  }
}

// Handle graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Start the application
startBot().catch((error) => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});