import { Command } from 'commander';
import { TradingBot } from './services/TradingBot';
import { Interval } from '@binance/connector-typescript';
import * as dotenv from 'dotenv';
import * as chalk from 'chalk';

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
  .action(async (symbol: string, options: { interval: string; recheck: boolean }) => {
    const bot = new TradingBot();
    try {
      console.log(chalk.blue('🔄 Initializing trading bot...'));
      console.log(chalk.blue(`Symbol: ${symbol}`));
      console.log(chalk.blue(`Interval: ${options.interval}`));
      console.log(chalk.blue(`Mode: ${options.recheck ? 'Rechecking existing plan' : 'Generating new plan'}`));

      if (options.recheck) {
        await bot.recheckLastPlan(symbol, options.interval);
      } else {
        await bot.startMonitoring(symbol, options.interval as Interval);
      }
    } catch (error) {
      console.error(chalk.red('Error:', error));
      process.exit(1);
    } finally {
      await bot.cleanup();
    }
  });

program.parse(); 