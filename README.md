# Ocean Navy Bot 🌊

Real-time OCEAN DEX buy alerts for Telegram with interactive configuration.

Monitor OCEAN token buys across multiple chains and DEXes. Get instant Telegram notifications with per-chat customizable settings.

## Features

- 🚀 **Real-time Buy Alerts** - Instant notifications for OCEAN DEX purchases
- 🌍 **Multi-Chain Support** - Ethereum & Polygon (more chains coming soon)
- 🎯 **Multi-DEX Support** - Monitors Uniswap v2, Uniswap v3, Balancer v2, QuickSwap
- ⚙️ **Interactive Configuration** - Control settings via Telegram commands
- 🔐 **Per-Chat Settings** - Each chat/group can customize their preferences
- 👥 **Admin Controls** - Only admins can modify settings in groups
- 🔄 **Reorg Handling** - Properly handles blockchain reorganizations
- 🎛️ **Webhook Support** - Works with Moralis, Alchemy, QuickNode, Tenderly
- 📊 **Batch Alerts** - Optional batching for high-volume periods
- ✅ **Dedupe System** - No duplicate alerts with LRU/TTL caching

## Architecture

```
Webhook Provider (Moralis/Alchemy/QuickNode)
    ↓
Express Webhook Endpoint
    ↓
Normalizer → Decoder → Classifier → Dedupe
    ↓
Telegram Bot → Multiple Chats (with individual settings)
```

## Prerequisites

- Node.js 20+
- A Telegram bot token (via [@BotFather](https://t.me/botfather))
- Webhook provider account (Moralis Streams, Alchemy Notify, QuickNode, or Tenderly)
- PM2 (process manager)

## Quick Start

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd OceanNavyBot
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# Server
PORT=8080
ENV=production

# Security
WEBHOOK_SECRET=your-random-secret-here-change-me
# IP_ALLOWLIST=1.2.3.4,5.6.7.8  # Optional

# Token
OCEAN_ADDRESS=0x967da4048cD07aB37855c090aAF366e4ce1b9F48

# Telegram
TELEGRAM_BOT_TOKEN=your-bot-token-from-botfather
TELEGRAM_CHAT_ID=your-default-chat-id
TELEGRAM_POLLING=true
# TELEGRAM_ALLOWED_CHATS=-1001234567890,-1009876543210  # Optional: Whitelist specific chats

# Alchemy (for RPC & balance queries)
ALCHEMY_API_KEY=your-alchemy-api-key-here

# Etherscan (for historical data queries)
ETHERSCAN_API_KEY=your-etherscan-api-key-here

# Alerts
DEBOUNCE_MS=0
MIN_OCEAN_ALERT=1.0
```

### 3. Create Telegram Bot

1. Message [@BotFather](https://t.me/botfather)
2. Send `/newbot` and follow instructions
3. Copy the bot token to `TELEGRAM_BOT_TOKEN`
4. Add your bot to your group/channel
5. Get chat ID (send a message, then visit `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`)
6. Copy chat ID to `TELEGRAM_CHAT_ID`
7. **Optional:** To restrict bot to specific chats, add `TELEGRAM_ALLOWED_CHATS` with comma-separated chat IDs

### 4. Configure Webhook Provider

Choose one provider and configure:

#### Moralis Streams (Recommended)

1. Go to [Moralis Streams](https://moralis.io/streams/)
2. Create streams for each pool you want to monitor (see `MONITORED_POOLS.md` for pool addresses)
3. For each stream, configure:
   - **Network**: Ethereum Mainnet, Polygon, etc.
   - **Address**: Pool contract address from `src/config/pools.ts`
   - **Webhook URL**: `https://your-domain.com/webhook`
   - **Header**: `X-Webhook-Secret: <your-secret-from-.env>`
   - **Topic0**: Event signature (varies by DEX - see `MONITORED_POOLS.md`)
   - **Include Logs**: ✅ Yes (required)

**Event Topics by DEX:**
- Uniswap V2 / QuickSwap: `0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822`
- Uniswap V3: `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`
- Balancer V2: `0x2170c741c41531aec20e7c107c24eecfdd15e69c9bb0a8dd37b1840b9e0b207b`

**Other Providers (Alchemy, QuickNode, Tenderly):**
The same webhook endpoint (`https://your-domain.com/webhook`) works for all providers. Just ensure you add the `X-Webhook-Secret` header.

### 5. Build & Deploy

```bash
# Build TypeScript
npm run build

# Start with PM2
npm run pm2:start

# View logs
npm run pm2:logs

# Monitor
npm run pm2:monit
```

### 6. Setup HTTPS (Required for Webhooks)

Use nginx or Caddy as reverse proxy:

**Caddy** (easiest):
```
your-domain.com {
    reverse_proxy localhost:8080
}
```

**Nginx**:
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## Bot Commands

### Everyone

- `/start` - Welcome message and current settings
- `/help` - Show all commands
- `/status` - View current alert settings for this chat
- `/ratio` - Show FET:OCEAN price ratio with historical data
- `/top` - Show top OCEAN buyers by time period (5m, 30m, 1h, 4h, 12h, 1d, 7d)

### Admins Only

- `/setmin <amount>` - Set minimum OCEAN amount (e.g., `/setmin 50`)
- `/enable` - Enable buy alerts for this chat
- `/disable` - Disable buy alerts for this chat

**Examples:**
```
/setmin 100     # Only alert for buys ≥ 100 OCEAN
/setmin 0.5     # Alert for all buys ≥ 0.5 OCEAN
/enable         # Turn on alerts
/disable        # Turn off alerts
/status         # Check current settings
```

## PM2 Commands

```bash
# Start
npm run pm2:start

# Stop
npm run pm2:stop

# Restart
npm run pm2:restart

# Delete from PM2
npm run pm2:delete

# View logs
npm run pm2:logs

# Monitor dashboard
npm run pm2:monit

# Save PM2 state (auto-restart on reboot)
pm2 save
pm2 startup
```

## Development

```bash
# Dev mode with hot reload
npm run dev

# Build
npm run build
```

## Project Structure

```
ocean-navy-bot/
├── src/
│   ├── config/           # Configuration files
│   │   ├── env.ts        # Environment validation (Zod)
│   │   ├── pools.ts      # Known DEX pools (multi-chain)
│   │   └── constants.ts  # Token addresses, topics, block explorers
│   ├── core/             # Core business logic
│   │   ├── types.ts      # TypeScript types
│   │   ├── normalizer.ts # Provider payload normalization
│   │   ├── decoder.ts    # Event log decoding
│   │   ├── classifier.ts # Buy/sell classification
│   │   ├── formatter.ts  # Telegram message formatting
│   │   └── dedupe.ts     # Deduplication manager
│   ├── dex/              # DEX-specific decoders
│   │   ├── univ2.ts      # Uniswap v2 / QuickSwap swap decoder
│   │   ├── univ3.ts      # Uniswap v3 swap decoder
│   │   └── balancer.ts   # Balancer v2 swap decoder
│   ├── telegram/         # Telegram bot logic
│   │   ├── client.ts     # Bot client & message sending
│   │   ├── commands.ts   # Command handlers
│   │   └── config.ts     # Per-chat config manager
│   ├── providers/        # Webhook handlers
│   │   └── webhook.ts    # Unified webhook handler
│   ├── middleware/       # Express middleware
│   │   ├── auth.ts       # Webhook secret & IP validation
│   │   └── errors.ts     # Error handlers
│   ├── abis/             # Contract ABIs
│   │   ├── erc20.json
│   │   ├── univ2pool.json
│   │   ├── univ3pool.json
│   │   └── balancerVault.json
│   ├── utils/            # Utility functions
│   │   ├── logger.ts     # Pino logger
│   │   ├── bigint.ts     # BigInt decimal formatting
│   │   └── set.ts        # LRU/TTL dedupe set
│   ├── app.ts            # Express app setup
│   └── server.ts         # HTTP server entry point
├── ecosystem.config.cjs  # PM2 configuration
├── package.json
├── tsconfig.json
├── .env.example
└── MONITORED_POOLS.md    # Pool addresses and configuration guide
```

## Currently Monitored Pools

**Ethereum (4 pools):**
- Uniswap V2 OCEAN/WETH
- Uniswap V3 OCEAN/WETH 0.3%
- Uniswap V3 OCEAN/USDT 0.3%
- Balancer V2 psdnOCEAN/OCEAN

**Polygon (1 pool):**
- QuickSwap OCEAN/WMATIC (~$750K TVL)

See `MONITORED_POOLS.md` for full details and pool addresses.

## Adding New Pools

1. **Find OCEAN pools** on your target chain/DEX
2. **Edit `src/config/pools.ts`** and add the pool:

```typescript
// Uniswap V2 / QuickSwap example
{
  type: 'uniswap-v2',
  chainId: 137,  // 1=Ethereum, 137=Polygon, 56=BSC
  chainName: 'Polygon',
  address: '0x...',
  token0: '0x...',  // Lower address
  token1: '0x...',  // Higher address
  label: 'QuickSwap OCEAN/WMATIC',
}

// Uniswap V3 example
{
  type: 'uniswap-v3',
  chainId: 1,
  chainName: 'Ethereum',
  address: '0x...',
  token0: '0x967da4048cd07ab37855c090aaf366e4ce1b9f48', // OCEAN
  token1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  fee: 3000,
  label: 'Uniswap v3 OCEAN/USDC 0.3%',
}
```

3. **Create Moralis stream** for the pool (see `MONITORED_POOLS.md` for Topic0 values)
4. **Rebuild and restart**:
```bash
npm run build && npm run pm2:restart
```

## Troubleshooting

### Bot not responding to commands

1. Check `TELEGRAM_POLLING=true` in `.env`
2. Verify bot token: `curl https://api.telegram.org/bot<TOKEN>/getMe`
3. Check PM2 logs: `npm run pm2:logs`

### No alerts appearing

1. Test webhook endpoint: `curl https://your-domain.com/healthz`
2. Check webhook provider dashboard for delivery status
3. Verify `X-Webhook-Secret` header matches `.env`
4. Check logs for decoding errors: `npm run pm2:logs`
5. Verify pool addresses in `src/config/pools.ts` match actual pools

### Duplicate alerts

- Dedupe system uses LRU cache (2000 items, 2hr TTL)
- If restarting frequently, duplicates may occur
- Increase cache size in `src/core/dedupe.ts` if needed

### Permission denied errors

- Ensure PM2 has write access to `./logs/` and `./config.json`
- Run: `chmod +x dist/server.js`

## Security

- ✅ Webhook secret validation (`X-Webhook-Secret` header)
- ✅ Optional IP allowlist
- ✅ Admin-only commands in groups
- ✅ No sensitive data in logs
- ✅ Strict TypeScript typing
- ✅ Input validation with Zod

**Never commit `.env` or `config.json` to version control!**

## Performance

- Handles 100+ swaps/minute with 0ms debounce
- ~50MB memory usage (idle)
- LRU cache prevents memory leaks
- PM2 auto-restart on crashes
- Max 500MB memory before restart

## License

MIT

## Support

- GitHub Issues: Report bugs or request features
- Telegram: Add bot to your group and use `/help`

## Credits

Built for Ocean Navy community 🌊

Powered by:
- [Uniswap v3](https://uniswap.org)
- [Balancer v2](https://balancer.fi)
- [viem](https://viem.sh)
- [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)
- [PM2](https://pm2.keymetrics.io)
