// services/NoTradeLogger.js - Logs decisions where no trade was executed

const fs = require('fs')
const path = require('path')

class NoTradeLogger {
	constructor(config) {
		this.config = config
		this.noTradesFile = config.noTradesFile
		this.ensureDirectory()
		this.ensureFile()
	}

	// =============================================
	// FILE MANAGEMENT
	// =============================================

	ensureDirectory() {
		const dir = path.dirname(this.noTradesFile)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
			console.log(`[NoTradeLogger] Created directory: ${dir}`)
		}
	}

	ensureFile() {
		if (!fs.existsSync(this.noTradesFile)) {
			const header = [
				'timestamp',
				'price',
				'rsi',
				'rsiStatus',
				'rsiTrend',
				'slowdownDetected',
				'slowdownSignificant',
				'slowdownTimeframe',
				'slowdownScore',
				'confidence',
				'minConfidenceRequired',
				'priceAction',
				'volumeRatio',
				'volumeInterpretation',
				'adxValue', // ADDED
				'adxState', // ADDED
				'adxBlocked', // ADDED
				'reasons'
			].join(',')
			fs.writeFileSync(this.noTradesFile, header + '\n')
		}
	}

	// =============================================
	// LOG NO-TRADE DECISION
	// =============================================

	logNoTrade(data, decision, rsiSignal, slowdownSignal, priceActionSignal, volumeSignal, adxSignal) {
		// Extract volume data safely
		let volumeRatio = 'N/A'
		let volumeInterpretation = 'N/A'

		if (volumeSignal && volumeSignal.success && volumeSignal.data) {
			volumeRatio = (volumeSignal.data.volumeRatio || 0).toFixed(2)
			volumeInterpretation = volumeSignal.data.interpretation || 'NORMAL'
		}

		// Extract ADX data safely - NEW
		let adxValue = 'N/A'
		let adxState = 'N/A'
		let adxBlocked = 'NO'

		if (adxSignal) {
			if (adxSignal.success) {
				adxValue = (adxSignal.value || 0).toFixed(2)
				adxState = adxSignal.marketState || 'UNKNOWN'
			}
			if (adxSignal.isBlocking) {
				adxBlocked = 'YES'
			}
		}

		const row = [
			data.timestamp,
			data.price.price.toFixed(2),
			data.rsi.currentRsi.toFixed(2),
			data.rsi.status || 'UNKNOWN',
			data.rsi.rsiTrend || 'FLAT',
			slowdownSignal.detected ? 'YES' : 'NO',
			slowdownSignal.isSignificant ? 'YES' : 'NO',
			slowdownSignal.timeframe || 'none',
			(slowdownSignal.score || 0).toFixed(2),
			decision.confidence.toFixed(2),
			this.config.minConfidence.toFixed(2),
			priceActionSignal.momentum || 'NEUTRAL',
			volumeRatio,
			volumeInterpretation,
			adxValue, // ADDED
			adxState, // ADDED
			adxBlocked, // ADDED
			decision.reasons.join('; ')
		].join(',')

		try {
			fs.appendFileSync(this.noTradesFile, row + '\n')
		} catch (error) {
			console.error('[NoTradeLogger] Failed to write no-trade:', error.message)
		}
	}

	// =============================================
	// READ NO-TRADE HISTORY
	// =============================================

	getNoTrades(limit = 100) {
		try {
			const content = fs.readFileSync(this.noTradesFile, 'utf8')
			const lines = content.split('\n').filter((line) => line.trim())
			if (lines.length <= 1) return []

			const header = lines[0].split(',')
			const rows = lines.slice(1)
			return rows.slice(-limit).map((row) => {
				const values = row.split(',')
				const entry = {}
				header.forEach((key, index) => {
					entry[key] = values[index] || ''
				})
				return entry
			})
		} catch (error) {
			console.error('[NoTradeLogger] Failed to read no-trades:', error.message)
			return []
		}
	}

	// =============================================
	// STATISTICS
	// =============================================

	getStats() {
		const noTrades = this.getNoTrades(1000)
		if (noTrades.length === 0) {
			return { total: 0 }
		}

		// Count reasons for no-trade
		const reasonCounts = {}
		noTrades.forEach((nt) => {
			const reasons = nt.reasons ? nt.reasons.split('; ') : ['Unknown']
			reasons.forEach((reason) => {
				reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
			})
		})

		// Get average RSI when no trade
		const avgRsi = noTrades.reduce((sum, nt) => sum + parseFloat(nt.rsi || 0), 0) / noTrades.length

		// Get ADX stats - NEW
		const adxBlockedCount = noTrades.filter((nt) => nt.adxBlocked === 'YES').length
		const avgAdx =
			noTrades.reduce((sum, nt) => {
				const val = parseFloat(nt.adxValue)
				return sum + (isNaN(val) ? 0 : val)
			}, 0) / noTrades.length

		return {
			total: noTrades.length,
			avgRsi: avgRsi || 0,
			avgAdx: avgAdx || 0, // ADDED
			adxBlockedCount: adxBlockedCount, // ADDED
			reasonCounts: reasonCounts
		}
	}
}

module.exports = NoTradeLogger
