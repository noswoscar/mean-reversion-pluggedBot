// config/Config.js - Central configuration for the bot

const path = require('path')

class Config {
	constructor(options = {}) {
		// =============================================
		// SERVICE URLs
		// =============================================
		this.rsiServiceUrl = options.rsiServiceUrl || process.env.RSI_SERVICE_URL || 'http://localhost:7006'
		this.slowdownServiceUrl = options.slowdownServiceUrl || process.env.SLOWDOWN_SERVICE_URL || 'http://localhost:7005'
		this.priceServiceUrl = options.priceServiceUrl || process.env.PRICE_SERVICE_URL || 'http://localhost:7001'
		this.volumeServiceUrl = options.volumeServiceUrl || process.env.VOLUME_SERVICE_URL || 'http://localhost:7008'

		// =============================================
		// BOT PARAMETERS
		// =============================================
		this.botName = options.botName || process.env.BOT_NAME || 'MeanReversionBot5'
		this.botLoopInterval = parseInt(options.botLoopInterval || process.env.BOT_LOOP_INTERVAL || 10000) // 10 seconds
		this.minConfidence = parseFloat(options.minConfidence || process.env.MIN_CONFIDENCE || 0.5) // LOWERED for testing
		this.accountBalance = parseFloat(options.accountBalance || process.env.ACCOUNT_BALANCE || 25)

		// =============================================
		// RISK PARAMETERS (Adjusted for Mean Reversion)
		// =============================================
		this.stopLossPercent = parseFloat(options.stopLossPercent || process.env.STOP_LOSS_PERCENT || 0.01) // 1%
		this.takeProfitPercent = parseFloat(options.takeProfitPercent || process.env.TAKE_PROFIT_PERCENT || 0.02) // 2.0%
		this.maxRiskPerTrade = parseFloat(options.maxRiskPerTrade || process.env.MAX_RISK_PER_TRADE || 0.02) // 2% of account
		this.maxHoldingHours = parseFloat(options.maxHoldingHours || process.env.MAX_HOLDING_HOURS || 8) // 8 hours

		// =============================================
		// RSI THRESHOLDS
		// =============================================
		this.rsiOverbought = parseFloat(options.rsiOverbought || process.env.RSI_OVERBOUGHT || 55)
		this.rsiOversold = parseFloat(options.rsiOversold || process.env.RSI_OVERSOLD || 45)
		this.rsiExtremeOverbought = parseFloat(options.rsiExtremeOverbought || process.env.RSI_EXTREME_OVERBOUGHT || 55)
		this.rsiExtremeOversold = parseFloat(options.rsiExtremeOversold || process.env.RSI_EXTREME_OVERSOLD || 45)

		// =============================================
		// SLOWDOWN PARAMETERS
		// =============================================
		this.slowdownSignificanceThreshold = parseFloat(
			options.slowdownSignificanceThreshold || process.env.SLOWDOWN_THRESHOLD || 0.12
		)
		this.slowdownTimeframes = options.slowdownTimeframes || ['10s', '30s', '1m', '5m', '15m', '1h']

		// =============================================
		// LOGGING
		// =============================================
		this.dataDir = options.dataDir || process.env.DATA_DIR || path.join(__dirname, '../data')
		this.tradesFile = options.tradesFile || path.join(this.dataDir, 'trades.csv')
		this.noTradesFile = options.noTradesFile || path.join(this.dataDir, 'no_trades.csv')
		this.tradeResultsFile = options.tradeResultsFile || path.join(this.dataDir, 'trade_results.csv')

		// =============================================
		// OTHER
		// =============================================
		this.timeout = parseInt(options.timeout || process.env.TIMEOUT || 5000)
	}

	// =============================================
	// VALIDATION
	// =============================================

	validate() {
		const errors = []

		if (this.stopLossPercent >= this.takeProfitPercent) {
			errors.push(`Stop loss (${this.stopLossPercent}) must be less than take profit (${this.takeProfitPercent})`)
		}

		if (this.minConfidence < 0 || this.minConfidence > 1) {
			errors.push(`Min confidence must be between 0 and 1 (got ${this.minConfidence})`)
		}

		if (this.maxRiskPerTrade < 0 || this.maxRiskPerTrade > 0.1) {
			errors.push(`Max risk per trade must be between 0 and 0.1 (got ${this.maxRiskPerTrade})`)
		}

		if (this.rsiOverbought <= this.rsiOversold) {
			errors.push(`RSI overbought (${this.rsiOverbought}) must be greater than oversold (${this.rsiOversold})`)
		}

		return {
			valid: errors.length === 0,
			errors: errors
		}
	}

	// =============================================
	// DISPLAY
	// =============================================

	display() {
		console.log('=========================================')
		console.log(`📊 ${this.botName} Configuration`)
		console.log('=========================================')
		console.log(`🔗 RSI Service:       ${this.rsiServiceUrl}`)
		console.log(`🔗 Slowdown Service:  ${this.slowdownServiceUrl}`)
		console.log(`🔗 Price Service:     ${this.priceServiceUrl}`)
		console.log(`⏱️  Loop Interval:     ${this.botLoopInterval}ms`)
		console.log(`📊 Min Confidence:    ${(this.minConfidence * 100).toFixed(0)}%`)
		console.log(`💰 Account Balance:   $${this.accountBalance.toLocaleString()}`)
		console.log('-----------------------------------------')
		console.log(`🛑 Stop Loss:         ${(this.stopLossPercent * 100).toFixed(1)}%`)
		console.log(`🎯 Take Profit:       ${(this.takeProfitPercent * 100).toFixed(1)}%`)
		console.log(`📉 Max Risk/Trade:    ${(this.maxRiskPerTrade * 100).toFixed(1)}%`)
		console.log(`⏰ Max Holding:       ${this.maxHoldingHours}h`)
		console.log('-----------------------------------------')
		console.log(`📈 RSI Overbought:    ${this.rsiOverbought}`)
		console.log(`📉 RSI Oversold:      ${this.rsiOversold}`)
		console.log(`🔥 RSI Extreme OB:    ${this.rsiExtremeOverbought}`)
		console.log(`🧊 RSI Extreme OS:    ${this.rsiExtremeOversold}`)
		console.log(`📊 Slowdown Threshold:${this.slowdownSignificanceThreshold}`)
		console.log('-----------------------------------------')
		console.log(`📁 Data Directory:    ${this.dataDir}`)
		console.log('=========================================')
	}
}

module.exports = Config
