import { Command } from 'commander';
import { TradingBot } from './bots/TradingBot';
import { Interval } from '@binance/connector-typescript';
import * as dotenv from 'dotenv';
import * as chalk from 'chalk';
import { SMCTradingBot } from './bots/SMCTradingBot';
import { SMCTradingManager } from './managers/SMCTradingManager';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'BINANCE_API_KEY',
  'BINANCE_API_SECRET',
  'OPENAI_PROJECT_ID',
  'OPENAI_API_KEY'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(chalk.red(`Missing required environment variable: ${envVar}`));
    process.exit(1);
  }
}

const program = new Command();

program
  .name('trading-bot')
  .description('AI-powered trading bot for cryptocurrency analysis')
  .version('1.0.0');

program
  .command('analyze')
  .description('Generate a new trading plan or recheck an existing one')
  .argument('<symbol>', 'Trading pair symbol (e.g., BTCUSDT)')
  .option('-i, --interval <interval>', 'Trading interval', '15m')
  .option('-r, --recheck', 'Recheck existing plan instead of generating new one', false)
  .option('-s, --smc', 'Use Smart Money Concept', false)
  .action(async (symbol: string, options: { interval: string; recheck: boolean; smc: boolean }) => {
    try {
      console.log(chalk.blue('🔄 Initializing trading bot...'));
      console.log(chalk.blue(`Symbol: ${symbol}`));
      console.log(chalk.blue(`Interval: ${options.interval}`));
      console.log(chalk.blue(`Mode: ${options.recheck ? 'Rechecking existing plan' : 'Generating new plan'}`));

      if (options.recheck) {
        const bot = new TradingBot();
        await bot.recheckLastPlan(symbol, options.interval);
        await bot.cleanup();
      } else {
        if (options.smc) {
          console.log(chalk.blue('🔄 Initializing SMC trading bot...'));
          // Initialize SMC bot with API credentials
          const smcBot = new SMCTradingBot(
            process.env.BINANCE_API_KEY!,
            process.env.BINANCE_API_SECRET!
          );
          
          const tradingPlan = await smcBot.analyzeSMC(symbol);
          
          if (tradingPlan) {
            console.log(chalk.green('✅ Trading plan generated:'));
            console.log(JSON.stringify(tradingPlan, null, 2));
          } else {
            console.log(chalk.yellow('No valid trading setup found'));
          }
        } else {
          const bot = new TradingBot();
          await bot.startMonitoring(symbol, options.interval as Interval);
          await bot.cleanup();
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:', error));
      process.exit(1);
    }
  });

// Add new command for continuous SMC monitoring
program
  .command('monitor-smc')
  .description('Continuously monitor trading pairs using Smart Money Concept')
  .option('-s, --symbols <symbols>', 'Comma-separated list of symbols to monitor (e.g., BTCUSDT,ETHUSDT)', 'BTCUSDT,ETHUSDT')
  .option('-i, --interval <minutes>', 'Scan interval in minutes', '5')
  .action(async (options: { symbols: string; interval: string }) => {
    try {
      const symbols = options.symbols.split(',');
      const intervalMinutes = parseInt(options.interval, 10);
      
      console.log(chalk.blue('🔄 Starting SMC Trading Manager...'));
      console.log(chalk.blue(`Symbols: ${symbols.join(', ')}`));
      console.log(chalk.blue(`Scan interval: ${intervalMinutes} minutes`));
      
      // Initialize and start trading manager
      const tradingManager = new SMCTradingManager(
        symbols,
        intervalMinutes
      );
      
      await tradingManager.start();
      
      // Keep the process running
      console.log(chalk.green('✅ Trading manager running. Press Ctrl+C to stop.'));
      
      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n⚠️ Shutting down trading manager...'));
        tradingManager.stop();
        process.exit(0);
      });
      
    } catch (error) {
      console.error(chalk.red('Error:', error));
      process.exit(1);
    }
  });

program.parse(); 