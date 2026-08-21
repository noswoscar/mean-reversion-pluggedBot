// index.js - Main entry point for Mean Reversion Bot
// UPDATED: Volume data passed to loggers
// FIXED: ADX data passed to trade loggers

const Config = require('./config/Config')
const DataGatherer = require('./services/DataGatherer')
const RangeStrategy = require('./services/RangeStrategy')
const TradeLogger = require('./services/TradeLogger')
const NoTradeLogger = require('./services/NoTradeLogger')

// =============================================
// LOAD CONFIGURATION
// =============================================

const config = new Config()
config.display()

// Validate configuration
const validation = config.validate()
if (!validation.valid) {
	console.error('❌ Invalid configuration:')
	validation.errors.forEach((err) => console.error(`   - ${err}`))
	process.exit(1)
}
console.log('✅ Configuration valid\n')

// =============================================
// INITIALIZE SERVICES
// =============================================

const dataGatherer = new DataGatherer(config)
console.log('✅ Data Gatherer initialized')

const strategy = new RangeStrategy(config)
console.log('✅ Range Strategy initialized')

const tradeLogger = new TradeLogger(config)
console.log('✅ Trade Logger initialized')

const noTradeLogger = new NoTradeLogger(config)
console.log('✅ No-Trade Logger initialized')

// =============================================
// BOT STATE
// =============================================

let isRunning = false
let botInterval = null
let tradeId = 0
let currentVolumeData = null // Store volume for trade logging
let currentAdxData = null // ← ADDED: Store ADX for trade logging

// =============================================
// MAIN BOT LOOP
// =============================================

async function botLoop() {
	if (!isRunning) return

	try {
		console.log(`\n[${new Date().toISOString()}] 🔄 Checking market...`)

		// Step 1: Gather data
		const data = await dataGatherer.gatherAllData()
		if (!data.success) {
			console.log(`   ⚠️ Failed to gather data: ${data.error}`)
			return
		}

		// Store volume and ADX data for trade logging
		currentVolumeData = data.volume || null
		currentAdxData = data.adx || null // ← ADDED

		// Display volume info if available
		let volumeInfo = ''
		if (data.volume && data.volume.success && data.volume.data) {
			const vol = data.volume.data
			volumeInfo = ` | Volume: ${vol.volumeRatio?.toFixed(2) || 'N/A'}x (${vol.interpretation || 'N/A'})`
		}

		// Display ADX info if available ← ADDED
		let adxInfo = ''
		if (data.adx && data.adx.success) {
			adxInfo = ` | ADX: ${data.adx.value.toFixed(2)} (${data.adx.marketState})`
		} else if (data.adx && !data.adx.success) {
			adxInfo = ` | ADX: FAILED`
		}

		console.log(
			`   📊 Price: $${data.price.price.toFixed(2)} | RSI: ${data.rsi.currentRsi.toFixed(1)} | Status: ${data.rsi.status}${volumeInfo}${adxInfo}`
		)

		// Step 2: Make decision
		const decision = await strategy.makeDecision(data)

		// Step 3: Get signal components for logging
		const rsiSignal = strategy.analyzeRSI(data.rsi)
		const slowdownSignal = strategy.analyzeSlowdown(data.slowdown, data.price.price)
		const priceActionSignal = strategy.analyzePriceAction(data.price.price)

		// Step 4: Log no-trade if applicable
		console.log('Log no trade if applicable? : ', decision, (await decision).action, strategy.getPosition())
		if (decision.action === 'HOLD' && strategy.getPosition() === null) {
			noTradeLogger.logNoTrade(
				data,
				decision,
				rsiSignal,
				slowdownSignal,
				priceActionSignal,
				data.volume,
				data.adx // ← ADDED: Pass ADX to no-trade logger
			)
			console.log(`   ⏸️ HOLD: ${decision.reasons.join('; ')}`)
			return
		}

		// Step 5: Execute trade
		if (decision.action === 'BUY' || decision.action === 'SELL') {
			// Open position
			const position = {
				tradeId: ++tradeId,
				side: decision.signal.direction,
				entryPrice: decision.signal.entryPrice,
				stopLoss: decision.risk.stopLoss,
				takeProfit: decision.risk.takeProfit,
				size: decision.risk.positionSize,
				entryTime: new Date().toISOString(),
				entryReason: decision.signal.reason,
				confidence: decision.confidence,
				status: 'OPEN',
				volumeData: currentVolumeData, // Store volume with position
				adxData: currentAdxData // ← ADDED: Store ADX with position
			}

			strategy.setPosition(position)

			// Display volume info on entry
			let entryVolumeInfo = ''
			if (currentVolumeData && currentVolumeData.success && currentVolumeData.data) {
				const vol = currentVolumeData.data
				entryVolumeInfo = ` | Volume: ${vol.volumeRatio?.toFixed(2) || 'N/A'}x (${vol.interpretation || 'N/A'})`
			}

			// Display ADX info on entry ← ADDED
			let entryAdxInfo = ''
			if (currentAdxData && currentAdxData.success) {
				entryAdxInfo = ` | ADX: ${currentAdxData.value.toFixed(2)} (${currentAdxData.marketState})`
			}

			console.log(
				`   🚀 ${position.side} OPEN: $${position.entryPrice.toFixed(2)} | Size: ${position.size.toFixed(4)} | Confidence: ${(position.confidence * 100).toFixed(0)}%${entryVolumeInfo}${entryAdxInfo}`
			)
			console.log(`   🛑 Stop: $${position.stopLoss.toFixed(2)} | 🎯 Target: $${position.takeProfit.toFixed(2)}`)
			console.log(`   📝 ${position.entryReason}`)

			return
		}

		if (decision.action === 'EXIT') {
			// Close position
			const position = strategy.getPosition()
			if (!position) {
				console.log('   ⚠️ No position to exit')
				return
			}

			const exitPrice = data.price.price
			const grossPnL = strategy.calculatePnL(position, exitPrice)
			const fee = Math.abs(grossPnL) * 0.001 // 0.1% fee
			const netPnL = grossPnL - fee

			const exitedTrade = {
				tradeId: position.tradeId,
				side: position.side,
				entryPrice: position.entryPrice,
				exitPrice: exitPrice,
				size: position.size,
				grossPnL: grossPnL,
				fee: fee,
				netPnL: netPnL,
				entryTime: position.entryTime,
				exitTime: new Date().toISOString(),
				entryReason: position.entryReason,
				exitReason: decision.reasons.join('; '),
				confidence: position.confidence,
				volumeData: position.volumeData || null,
				adxData: position.adxData || null // ← ADDED: Pass ADX from position
			}

			// Log the trade
			tradeLogger.logTrade(exitedTrade)

			// Clear position
			strategy.clearPosition()

			const pnlEmoji = netPnL >= 0 ? '✅' : '❌'
			console.log(
				`   ${pnlEmoji} ${position.side} CLOSED: $${exitPrice.toFixed(2)} | PnL: $${netPnL.toFixed(2)} | ${((netPnL / (position.entryPrice * position.size)) * 100).toFixed(2)}%`
			)
			console.log(`   📝 ${decision.reasons.join('; ')}`)

			// Display updated stats
			const stats = tradeLogger.getStats()
			console.log(
				`   📊 Stats: ${stats.total} trades | ${stats.winRate.toFixed(1)}% win rate | Total PnL: $${stats.totalPnL.toFixed(2)}`
			)

			return
		}
	} catch (error) {
		console.error(`   ❌ Error in bot loop: ${error.message}`)
	}
}

// =============================================
// START / STOP
// =============================================

function start() {
	if (isRunning) {
		console.log('⚠️ Bot is already running')
		return
	}

	console.log(`\n🚀 Starting Mean Reversion Bot...`)
	console.log(`⏱️  Loop interval: ${config.botLoopInterval}ms`)
	console.log(`📁 Data directory: ${config.dataDir}\n`)

	isRunning = true
	botInterval = setInterval(botLoop, config.botLoopInterval)

	// Run immediately
	botLoop()
}

function stop() {
	if (!isRunning) {
		console.log('⚠️ Bot is not running')
		return
	}

	console.log('\n🛑 Stopping Mean Reversion Bot...')
	isRunning = false
	if (botInterval) {
		clearInterval(botInterval)
		botInterval = null
	}

	// Display final stats
	const stats = tradeLogger.getStats()
	const noTradeStats = noTradeLogger.getStats()

	console.log('\n📊 Final Statistics:')
	console.log(`   Trades: ${stats.total}`)
	console.log(`   Win Rate: ${stats.winRate.toFixed(1)}%`)
	console.log(`   Total PnL: $${stats.totalPnL.toFixed(2)}`)
	console.log(`   Avg PnL: $${stats.avgPnL.toFixed(2)}`)
	console.log(`   Avg Holding: ${stats.avgHoldingHours.toFixed(1)}h`)
	console.log(`   Max Win: $${stats.maxWin.toFixed(2)}`)
	console.log(`   Max Loss: $${stats.maxLoss.toFixed(2)}`)
	console.log(`   No-Trades: ${noTradeStats.total}`)
	console.log('✅ Bot stopped')
}

// =============================================
// GRACEFUL SHUTDOWN
// =============================================

async function shutdown() {
	console.log('\n🛑 Shutting down...')
	stop()
	console.log('✅ Shutdown complete')
	process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// =============================================
// EXPOSE CONTROLS
// =============================================

module.exports = {
	config,
	dataGatherer,
	strategy,
	tradeLogger,
	noTradeLogger,
	start,
	stop,
	botLoop
}

// =============================================
// AUTO-START (if not required)
// =============================================

if (require.main === module) {
	start()
}
