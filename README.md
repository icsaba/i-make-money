# Trading Bot

## Environment Setup

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Fill in your API credentials in `.env`:
- Get Binance API credentials from [Binance API Management](https://www.binance.com/en/my/settings/api-management)
- Get OpenAI API credentials from [OpenAI API Keys](https://platform.openai.com/api-keys)

3. Required Environment Variables:
```
BINANCE_API_KEY=       # Your Binance API key
BINANCE_API_SECRET=    # Your Binance API secret
OPENAI_PROJECT_ID=     # Your OpenAI project ID
OPENAI_API_KEY=        # Your OpenAI API key
```

4. Optional Settings:
```
NODE_ENV=development   # development or production
LOG_LEVEL=debug       # debug, info, warn, or error
```

⚠️ Security Notes:
- Never commit your `.env` file
- Keep your API keys secure and rotate them periodically
- Use read-only API keys when possible
- Monitor your API usage regularly 