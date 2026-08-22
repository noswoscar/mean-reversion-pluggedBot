// services/TradeLogger.js - Logs executed trades with better number formatting

const fs = require('fs')
const path = require('path')

class TradeLogger {
	constructor(config) {
		this.config = config
		this.tradesFile = config.tradesFile
		this.tradeResultsFile = config.tradeResultsFile
		this.ensureDirectory()
		this.ensureFiles()
	}

	// =============================================
	// FILE MANAGEMENT
	// =============================================

	ensureDirectory() {
		const dir = path.dirname(this.tradesFile)
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true })
			console.log(`[TradeLogger] Created directory: ${dir}`)
		}
	}

	ensureFiles() {
		// Trades file
		if (!fs.existsSync(this.tradesFile)) {
			const header = [
				'exitTime',
				'side',
				'entryPrice',
				'exitPrice',
				'size',
				'grossPnL',
				'fee',
				'netPnL',
				'entryTime',
				'entryReason',
				'exitReason',
				'confidence',
				'holdingHours',
				'entryVolumeRatio',
				'entryVolumeInterpretation',
				'entryADX',
				'entryADXState'
			].join(',')
			fs.writeFileSync(this.tradesFile, header + '\n')
		}

		// Trade Results file
		if (!fs.existsSync(this.tradeResultsFile)) {
			const header = [
				'tradeId',
				'startTime',
				'endTime',
				'side',
				'entryPrice',
				'exitPrice',
				'size',
				'grossPnL',
				'fee',
				'netPnL',
				'returnPercent',
				'entryReason',
				'exitReason',
				'holdingHours',
				'entryVolumeRatio',
				'entryVolumeInterpretation',
				'entryADX',
				'entryADXState'
			].join(',')
			fs.writeFileSync(this.tradeResultsFile, header + '\n')
		}
	}

	// =============================================
	// HELPER: SMART NUMBER FORMATTING
	// =============================================

	formatNumber(value, decimals = 2) {
		if (value === undefined || value === null || isNaN(value)) return '0'

		// Use scientific notation for very small numbers
		const absValue = Math.abs(value)
		if (absValue > 0 && absValue < 0.0001) {
			return value.toExponential(4)
		}

		// Auto-adjust decimal places based on magnitude
		let decimalPlaces = decimals
		if (absValue < 0.01) decimalPlaces = 8
		else if (absValue < 1) decimalPlaces = 6
		else if (absValue < 100) decimalPlaces = 4
		else decimalPlaces = 2

		return value.toFixed(decimalPlaces)
	}

	formatPrice(value) {
		if (value === undefined || value === null || isNaN(value)) return '0'
		return value.toFixed(2)
	}

	formatSize(value) {
		if (value === undefined || value === null || isNaN(value)) return '0'
		// Show at least 8 decimal places for BTC amounts
		return value.toFixed(8)
	}

	// =============================================
	// LOG COMPLETED TRADE
	// =============================================

	logTrade(trade) {
		// Calculate holding hours
		const entryTime = new Date(trade.entryTime).getTime()
		const exitTime = new Date(trade.exitTime).getTime()
		const holdingHours = (exitTime - entryTime) / (1000 * 60 * 60)

		// Calculate return percentage
		const returnPercent = (trade.netPnL / (trade.entryPrice * trade.size)) * 100

		// Extract volume data safely
		let entryVolumeRatio = 'N/A'
		let entryVolumeInterpretation = 'N/A'

		if (trade.volumeData && trade.volumeData.success && trade.volumeData.data) {
			entryVolumeRatio = this.formatNumber(trade.volumeData.data.volumeRatio || 0, 2)
			entryVolumeInterpretation = trade.volumeData.data.interpretation || 'NORMAL'
		}

		// Extract ADX data safely
		let entryADX = 'N/A'
		let entryADXState = 'N/A'

		if (trade.adxData && trade.adxData.success) {
			entryADX = this.formatNumber(trade.adxData.value || 0, 2)
			entryADXState = trade.adxData.marketState || 'UNKNOWN'
		}

		// =============================================
		// Write to trades.csv (detailed)
		// =============================================

		const tradeRow = [
			trade.exitTime,
			trade.side,
			this.formatPrice(trade.entryPrice),
			this.formatPrice(trade.exitPrice),
			this.formatSize(trade.size), // Now shows full precision
			this.formatNumber(trade.grossPnL, 2),
			this.formatNumber(trade.fee || 0, 8), // Show fee with more precision
			this.formatNumber(trade.netPnL, 2),
			trade.entryTime,
			trade.entryReason || '',
			trade.exitReason || '',
			this.formatNumber(trade.confidence || 0, 2),
			this.formatNumber(holdingHours, 2),
			entryVolumeRatio,
			entryVolumeInterpretation,
			entryADX,
			entryADXState
		].join(',')

		try {
			fs.appendFileSync(this.tradesFile, tradeRow + '\n')
		} catch (error) {
			console.error('[TradeLogger] Failed to write trade:', error.message)
		}

		// =============================================
		// Write to trade_results.csv (summary)
		// =============================================

		const resultRow = [
			trade.tradeId || Date.now(),
			trade.entryTime,
			trade.exitTime,
			trade.side,
			this.formatPrice(trade.entryPrice),
			this.formatPrice(trade.exitPrice),
			this.formatSize(trade.size), // Show full precision
			this.formatNumber(trade.grossPnL, 2),
			this.formatNumber(trade.fee || 0, 8),
			this.formatNumber(trade.netPnL, 2),
			this.formatNumber(returnPercent, 4), // Show more precision for small percentages
			trade.entryReason || '',
			trade.exitReason || '',
			this.formatNumber(holdingHours, 2),
			entryVolumeRatio,
			entryVolumeInterpretation,
			entryADX,
			entryADXState
		].join(',')

		try {
			fs.appendFileSync(this.tradeResultsFile, resultRow + '\n')
		} catch (error) {
			console.error('[TradeLogger] Failed to write trade result:', error.message)
		}

		// Log with appropriate precision
		console.log(
			`[TradeLogger] ✅ Trade logged: ${trade.side} | Entry: ${this.formatPrice(trade.entryPrice)} | Exit: ${this.formatPrice(trade.exitPrice)} | ` +
				`Size: ${this.formatSize(trade.size)} BTC | PnL: $${this.formatNumber(trade.netPnL, 2)} | ${this.formatNumber(holdingHours, 1)}h | ` +
				`Volume: ${entryVolumeInterpretation} | ADX: ${entryADX} (${entryADXState})`
		)
	}

	// =============================================
	// READ HISTORY
	// =============================================

	getTrades(limit = 100) {
		try {
			const content = fs.readFileSync(this.tradesFile, 'utf8')
			const lines = content.split('\n').filter((line) => line.trim())
			if (lines.length <= 1) return []

			const header = lines[0].split(',')
			const rows = lines.slice(1)
			return rows.slice(-limit).map((row) => {
				const values = row.split(',')
				const trade = {}
				header.forEach((key, index) => {
					trade[key] = values[index] || ''
				})
				return trade
			})
		} catch (error) {
			console.error('[TradeLogger] Failed to read trades:', error.message)
			return []
		}
	}

	getTradeResults(limit = 100) {
		try {
			const content = fs.readFileSync(this.tradeResultsFile, 'utf8')
			const lines = content.split('\n').filter((line) => line.trim())
			if (lines.length <= 1) return []

			const header = lines[0].split(',')
			const rows = lines.slice(1)
			return rows.slice(-limit).map((row) => {
				const values = row.split(',')
				const result = {}
				header.forEach((key, index) => {
					result[key] = values[index] || ''
				})
				return result
			})
		} catch (error) {
			console.error('[TradeLogger] Failed to read trade results:', error.message)
			return []
		}
	}

	// =============================================
	// STATISTICS
	// =============================================

	getStats() {
		const trades = this.getTrades(1000)
		if (trades.length === 0) {
			return {
				total: 0,
				wins: 0,
				losses: 0,
				winRate: 0,
				totalPnL: 0,
				avgPnL: 0,
				avgHoldingHours: 0,
				maxWin: 0,
				maxLoss: 0
			}
		}

		const total = trades.length
		const wins = trades.filter((t) => parseFloat(t.netPnL) > 0).length
		const losses = trades.filter((t) => parseFloat(t.netPnL) < 0).length
		const totalPnL = trades.reduce((sum, t) => sum + parseFloat(t.netPnL || 0), 0)
		const holdingHours = trades.map((t) => parseFloat(t.holdingHours || 0))
		const avgHoldingHours = holdingHours.reduce((a, b) => a + b, 0) / holdingHours.length

		return {
			total,
			wins,
			losses,
			winRate: total > 0 ? (wins / total) * 100 : 0,
			totalPnL,
			avgPnL: total > 0 ? totalPnL / total : 0,
			avgHoldingHours,
			maxWin: trades.reduce((max, t) => Math.max(max, parseFloat(t.netPnL)), 0),
			maxLoss: trades.reduce((min, t) => Math.min(min, parseFloat(t.netPnL)), 0)
		}
	}
}

module.exports = TradeLogger
