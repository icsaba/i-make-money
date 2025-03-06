import { Interval, Spot } from '@binance/connector-typescript';
import * as technicalIndicators from 'technicalindicators';
import { TradingData, Candle, MarketMetrics } from '../types/trading';

export class BinanceService {
  private client: Spot;

  constructor(apiKey: string, apiSecret: string) {
    this.client = new Spot(apiKey, apiSecret);
  }

  async fetchMarketData(symbol: string, interval: Interval): Promise<TradingData> {
    try {
      const klines = await this.client.uiklines(symbol, interval, { limit: 100 });  
      const last100Candles = klines.map(this.transformKlineData);
      
      // Calculate indicators
      const indicators = await this.calculateIndicators(last100Candles);

      return {
        symbol,
        last100Candles,
        indicators
      };
    } catch (error) {
      console.error('Error fetching market data:', error);
      throw error;
    }
  }

  async getMarketMetrics(symbol: string): Promise<MarketMetrics> {
    try {
      // Get 24hr ticker
      const ticker24h = await this.client.ticker24hr({symbol});
      const tickerData = Array.isArray(ticker24h) ? ticker24h[0] : ticker24h;
      
      // Get current price from the 24h ticker
      const currentPrice = parseFloat(tickerData.lastPrice);
      
      // Get BTC dominance and market cap (if symbol is crypto)
      let dominance;
      if (symbol.endsWith('USDT')) {
        const btcTicker = await this.client.ticker24hr({symbol: 'BTCUSDT'});
        const btcData = Array.isArray(btcTicker) ? btcTicker[0] : btcTicker;
        const btcPrice = parseFloat(btcData.lastPrice);
        const totalMarketCap = btcPrice * parseFloat(tickerData.volume);
        dominance = (currentPrice * parseFloat(tickerData.volume)) / totalMarketCap * 100;
      }

      return {
        marketCap: currentPrice * parseFloat(tickerData.volume),
        dominance,
        volume24h: parseFloat(tickerData.volume),
        priceChange24h: parseFloat(tickerData.priceChangePercent)
      };
    } catch (error) {
      console.error('Error fetching market metrics:', error);
      throw error;
    }
  }

  private transformKlineData(kline: any[]): any {
    return {
      timestamp: kline[0],
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5])
    };
  }

  private async calculateIndicators(candles: Candle[]): Promise<any> {
    const prices = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    const rsi = technicalIndicators.RSI.calculate({
      values: prices,
      period: 14
    });

    const ema20 = technicalIndicators.EMA.calculate({
      values: prices,
      period: 20
    });

    const ema50 = technicalIndicators.EMA.calculate({
      values: prices,
      period: 50
    });

    const ema200 = technicalIndicators.EMA.calculate({
      values: prices,
      period: 200
    });

    const adx = technicalIndicators.ADX.calculate({
      high: highs,
      low: lows,
      close: prices,
      period: 14
    });

    return {
      rsi: rsi[rsi.length - 1],
      ema20: ema20[ema20.length - 1],
      ema50: ema50[ema50.length - 1],
      ema200: ema200[ema200.length - 1],
      adx: adx[adx.length - 1].adx
    };
  }
} 