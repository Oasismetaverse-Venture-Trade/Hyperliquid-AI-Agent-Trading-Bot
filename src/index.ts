/**
 * Polymarket Copy Trading Bot
 * Main entry point for the application
 */

import dotenv from 'dotenv';
import { AccountMonitor } from './monitors/account-monitor';
import { PolymarketClient } from './clients/polymarket-client';
import { CopyTradingMonitor } from './trading/copy-trading-monitor';

// Load environment variables from .env file
dotenv.config();

export { AccountMonitor } from './monitors/account-monitor';
export { PolymarketClient } from './clients/polymarket-client';
export { TradeExecutor } from './trading/trade-executor';
export { CopyTradingMonitor } from './trading/copy-trading-monitor';
export * from './types';

// Main entry point
if (require.main === module) {
  const targetAddress = process.env.TARGET_ADDRESS || '';
  const copyTradingEnabled = process.env.COPY_TRADING_ENABLED === 'true';
  const privateKey = process.env.PRIVATE_KEY || '';
  
   
  if (!targetAddress) {
    console.error('❌ Please set TARGET_ADDRESS environment variable');
    console.log('Usage: TARGET_ADDRESS=0x... npm run dev');
    process.exit(1);
  }

  if (copyTradingEnabled) {
    const trimmedKey = (privateKey || '').trim();
    const isPlaceholder =
      !trimmedKey ||
      /^0x0+$/i.test(trimmedKey) ||
      (trimmedKey.replace(/^0x/i, '').length === 64 && /^0+$/i.test(trimmedKey.replace(/^0x/i, '')));
    if (!trimmedKey || isPlaceholder) {
      console.error('❌ Invalid PRIVATE_KEY in .env');
      console.log('');
      console.log('Copy trading is enabled but PRIVATE_KEY is missing or still the placeholder.');
      console.log('Please set a valid Ethereum private key in your .env file:');
      console.log('  PRIVATE_KEY=0x<your-64-hex-characters>');
      console.log('');
      console.log('⚠️  Never use the example/placeholder key (e.g. 0x000...000) for real funds.');
      process.exit(1);
    }
  }

  const client = new PolymarketClient({
    // Optional: Add API key if needed
    // apiKey: process.env.POLYMARKET_API_KEY,
  });

  const pollInterval = parseInt(process.env.POLL_INTERVAL || '2000', 10);

  if (copyTradingEnabled) {
    // Use Copy Trading Monitor
    const dryRun = process.env.DRY_RUN === 'true';
    
    console.log('🚀 Starting Copy Trading Bot...');
    console.log(`📊 Target address: ${targetAddress}`);
    console.log(`🔍 Dry run mode: ${dryRun ? 'ENABLED' : 'DISABLED'}`);
    console.log(`💰 Position size multiplier: ${process.env.POSITION_SIZE_MULTIPLIER || '1.0'}x\n`);

    const copyTradingMonitor = new CopyTradingMonitor(
      client,
      {
        targetAddress,
        pollInterval,
        enableWebSocket: false,
        onUpdate: (status: any) => {
          const monitor = copyTradingMonitor.getAccountMonitor();
          console.log(monitor.getFormattedStatus(status));
        },
        onError: (error: any) => {
          console.error('Monitor error:', error.message);
        },
      },
      {
        enabled: true,
        privateKey,
        dryRun,
        positionSizeMultiplier: parseFloat(process.env.POSITION_SIZE_MULTIPLIER || '1.0'),
        maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || '10000'),
        maxTradeSize: parseFloat(process.env.MAX_TRADE_SIZE || '5000'),
        minTradeSize: parseFloat(process.env.MIN_TRADE_SIZE || '1'),
        slippageTolerance: parseFloat(process.env.SLIPPAGE_TOLERANCE || '1.0'),
        onTradeExecuted: (result) => {
          if (result.dryRun) {
            console.log('\n✅ [DRY RUN] Trade would be executed:', {
              success: result.success,
              quantity: result.executedQuantity,
              price: result.executedPrice,
              market: result.position.market.question.substring(0, 50) + '...',
              note: 'No order ID - this is a simulation (no real order placed)',
            });
          } else {
            console.log('\n✅ Trade executed successfully:', {
              success: result.success,
              orderId: result.orderId,
              quantity: result.executedQuantity,
              price: result.executedPrice,
              market: result.position.market.question.substring(0, 50) + '...',
            });
          }
        },
        onTradeError: (error, position) => {
          console.error('\n❌ Trade error:', {
            error: error.message,
            market: position.market.question.substring(0, 50) + '...',
          });
        },
      }
    );

    // Start copy trading
    copyTradingMonitor.start().catch((error: any) => {
      console.error('❌ Failed to start copy trading bot:', error);
      process.exit(1);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Shutting down copy trading bot...');
      const stats = copyTradingMonitor.getStats();
      console.log('\n📊 Final Statistics:');
      console.log(`   Total trades executed: ${stats.totalTradesExecuted}`);
      console.log(`   Total trades failed: ${stats.totalTradesFailed}`);
      console.log(`   Total volume: $${stats.totalVolume}`);
      copyTradingMonitor.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n\n🛑 Shutting down copy trading bot...');
      copyTradingMonitor.stop();
      process.exit(0);
    });
  } else {
    // Use Account Monitor only (monitoring without trading)
    console.log('📊 Starting Account Monitor (copy trading disabled)...');
    console.log(`📊 Target address: ${targetAddress}`);
    console.log(`⏱️  Polling interval: ${pollInterval / 1000} seconds\n`);

    const monitor = new AccountMonitor(client, {
      targetAddress,
      pollInterval,
      enableWebSocket: false,
      onUpdate: (status: any) => {
        console.log(monitor.getFormattedStatus(status));
      },
      onError: (error: any) => {
        console.error('Monitor error:', error.message);
      },
    });

    // Start monitoring
    monitor.start().catch((error: any) => {
      console.error('Failed to start monitor:', error);
      process.exit(1);
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\nShutting down monitor...');
      monitor.stop();
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\nShutting down monitor...');
      monitor.stop();
      process.exit(0);
    });
  }
}
