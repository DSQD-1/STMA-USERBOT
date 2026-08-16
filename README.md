# STMA

STMA is a Telegram Mini App + Bot API Business automation system.

## Features

- `/start` opens the Mini App.
- Mini App authentication with Telegram `initData`.
- AI-style natural-language command parser without an external AI key.
- Mute/unmute with automatic deletion of incoming messages.
- Scheduled message deletion.
- One-time messages.
- Message/event history.
- Monitoring dashboard.
- Up to 10 stored profile-watch targets.
- Quiet operation: actions are logged privately in the Mini App/database rather than posted into customer chats.
- Business connection storage.
- Statistics.

## Important Telegram permissions

For automatic deletion of customer messages, the connected business bot must have the Business right that allows deleting all messages. Telegram's Bot API documents `deleteBusinessMessages` and its required rights.

Profile watching is deliberately limited to data that this Bot API integration can actually receive. Arbitrary user profile fields such as gifts, music, Premium, Star Rating, etc. are not exposed to a normal Bot API business bot and therefore are not faked by STMA.

## Environment variables

Set these in Render/Replit/etc.:

- `BOT_TOKEN` — bot token from BotFather.
- `MINI_APP_URL` — public HTTPS URL of this project, e.g. `https://example.onrender.com`.
- `PORT` — optional, defaults to `10000`.
- `DB_PATH` — optional, defaults to `./stma.db`.
- `OWNER_ID` — optional numeric Telegram user ID. If omitted, the first validated Mini App user becomes the owner.
- `WEBHOOK_SECRET` — optional secret for Telegram webhook path.
- `PUBLIC_BASE_URL` — optional public HTTPS URL. If set, webhook is configured automatically.
- `WATCH_INTERVAL_MS` — optional, defaults to 120000.

## Deploy

1. Create the bot with BotFather.
2. Deploy this folder.
3. Set `BOT_TOKEN` and `MINI_APP_URL`.
4. Open the bot and send `/start`.
5. In BotFather, configure the Mini App URL.
6. Connect the bot to the Telegram Business account and grant the required rights.
7. If using automatic webhook setup, set `PUBLIC_BASE_URL` and `WEBHOOK_SECRET`.

## Local development

Run:

```bash
npm install
npm start
```

For Telegram Mini App validation and webhook delivery, the server must be reachable over HTTPS.
