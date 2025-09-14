# Personal Historian Telegram Bot

A conversational Telegram bot that helps document your daily activities and experiences, automatically saving them to Google Drive as daily markdown files for Obsidian. Perfect for ADHD-friendly life documentation with intelligent check-ins.

## Features

- 📝 **Conversational Life Logging**: Send text messages about what you're doing
- 📸 **Photo Documentation**: Send photos with captions to capture moments
- 🤖 **AI-Powered Responses**: Contextual, intelligent replies using OpenAI
- ⏰ **Smart Check-ins**: Bot asks how you're doing at appropriate intervals
- 📁 **Obsidian Integration**: Saves everything to daily markdown files in Google Drive
- 🔄 **Automatic Sync**: Files accessible on all your devices through Obsidian

## Architecture

- **Hosting**: Railway (persistent container)
- **Runtime**: Bun + TypeScript
- **Database**: PostgreSQL (minimal state for scheduling)
- **AI**: OpenAI GPT-4o-mini via Vercel AI SDK
- **Storage**: Google Drive API for photos and markdown files
- **Bot Framework**: Telegraf

## Setup

### 1. Prerequisites

- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- OpenAI API Key
- Google Cloud Service Account with Drive API access
- CloudClusters PostgreSQL database
- Railway account

### 2. Database Setup

Run the SQL script on your CloudClusters database:

```bash
psql -h your-host -U your-user -d your-db -f setup-db.sql
```

### 3. Google Drive Setup

1. Create a Google Cloud project
2. Enable Google Drive API
3. Create a Service Account
4. Download the JSON credentials
5. Share your Obsidian folder with the service account email
6. Note the folder ID from the URL

### 4. Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Required variables:
- `BOT_TOKEN`: Your Telegram bot token
- `TELEGRAM_ALLOWED_USER_ID`: Your Telegram user ID
- `DATABASE_URL`: PostgreSQL connection string
- `OPENAI_API_KEY`: OpenAI API key
- `GOOGLE_SERVICE_ACCOUNT_JSON`: Base64 encoded service account JSON
- `DRIVE_FOLDER_ID`: Google Drive folder ID for Obsidian
- `TZ_DEFAULT`: Your timezone (e.g., America/Los_Angeles)

### 5. Local Development

```bash
# Install dependencies
bun install

# Run in development mode (polling)
bun run dev
```

### 6. Railway Deployment

1. Push to GitHub
2. Connect Railway to your repository
3. Set environment variables in Railway dashboard
4. Deploy automatically

### 7. Set Telegram Webhook

After deployment, set your webhook:

```bash
curl -X POST "https://api.telegram.org/bot{BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-app.railway.app/webhook"}'
```

## Usage

1. Start the bot: `/start`
2. Send messages about what you're doing:
   - "Working on the telegram bot project"
   - "At a concert! Amazing energy here" (with photo)
   - "Just finished a great workout session"
3. The bot will:
   - Respond conversationally
   - Save to your daily markdown file
   - Schedule intelligent follow-ups
   - Handle photos and captions

## File Structure

```
src/
├── bot.ts              # Main bot application
├── scheduler.ts        # Check-in scheduling
└── lib/
    ├── db.ts          # Database operations
    ├── llm.ts         # OpenAI integration
    ├── drive.ts       # Google Drive operations
    └── telegram.ts    # Telegram utilities
```

## Daily File Format

Files are saved as `YYYY-MM-DD.md` in your Google Drive folder:

```markdown
# 2024-03-15

- [09:30] Working on the telegram bot project
- [12:15] ![Lunch photo](./attachments/2024-03-15-12-15-00-123456.jpg)
Had amazing sushi downtown
- [18:45] Finished work, heading to the gym
```

## Development

```bash
# Watch mode for development
bun run dev

# Build for production
bun run build

# Type checking
bun run type-check
```

## Troubleshooting

### Bot not responding
- Check Railway logs
- Verify environment variables
- Ensure webhook is set correctly

### Photos not uploading
- Verify Google service account permissions
- Check Drive folder is shared with service account
- Confirm `DRIVE_FOLDER_ID` is correct

### Database connection issues
- Verify `DATABASE_URL` format
- Check CloudClusters firewall settings
- Ensure SSL settings match your database

## Future Enhancements

- Voice message transcription
- Daily/weekly summaries
- Multi-user support
- Integration with other productivity tools
- Inline keyboard shortcuts

## License

MIT
