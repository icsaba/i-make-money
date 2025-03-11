# TradingBot Overview

The `TradingBot` class in `src/bots/TradingBot.ts` is the original AI-powered trading system in this application, operating in parallel to the newly-implemented SMC (Smart Money Concept) system. It combines traditional technical analysis with AI-driven decision making.

## Core functionality

The TradingBot integrates several key services and capabilities:

 1) Market Data Collection
    - Uses the BinanceService to fetch real-time market data
    - Retrieves candle data (OHLCV) from Binance API
    - Collects additional market metrics like volume, market cap, and dominance
 2) AI-Powered Analysis
    - Leverages OpenAI to analyze market data through `OpenAIService`
    - Generates trading plans based on pattern recognition and technical indicators
    - Uses prompts from the `PromptFactory` to structure the AI analysis
 3) Plan Management & Persistence
    - Stores trading plans in a database via `DatabaseService`
    - Tracks the progress of plans through different states
    - Allows for plan validation and rechecking as market conditions change
 4) Trade Life-Cycle Management
    - Monitors active trading plans
    - Updates plan status as market conditions evolve
    - Records profit/loss metrics

## Key Differences from SMCTradingBot
Unlike the new SMCTradingBot:
 - The original TradingBot relies heavily on AI (OpenAI) for analysis, whereas the SMC version uses algorithmic rules based on Smart Money Concept principles.
 - TradingBot stores plans in a database for long-term tracking, while the SMC version operates more as a real-time scanner.
 - TradingBot includes a more comprehensive validation and rechecking process for existing plans.

This dual-system approach gives users flexibility to choose between AI-driven analysis or the more deterministic SMC methodology for their trading decisions.

## Usage of AI plan analyzer

### Generate a new trading plan
```bash 
npm run start analyze BTCUSDT
```

### Generate a new trading plan with custom interval
```bash 
npm run start analyze BTCUSDT -- -i 1h
```

### Recheck existing plan
```bash 
npm run start analyze BTCUSDT -- -r
```

### Recheck with custom interval
```bash 
npm run start analyze BTCUSDT -- -i 4h -r
```

## Usage of SMC algo trader

```bash
npm start monitor-smc -- --symbols BTCUSDT,ETHUSDT,BNBUSDT,LTCUSDT --interval 5
```


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