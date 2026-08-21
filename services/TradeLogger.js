// services/TradeLogger.js - Logs executed trades

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
		// Trades file - UPDATED with ADX columns
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
				'entryADX', // ADDED
				'entryADXState' // ADDED
			].join(',')
			fs.writeFileSync(this.tradesFile, header + '\n')
		}

		// Trade Results file - UPDATED with ADX columns
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
				'entryADX', // ADDED
				'entryADXState' // ADDED
			].join(',')
			fs.writeFileSync(this.tradeResultsFile, header + '\n')
		}
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
			entryVolumeRatio = (trade.volumeData.data.volumeRatio || 0).toFixed(2)
			entryVolumeInterpretation = trade.volumeData.data.interpretation || 'NORMAL'
		}

		// Extract ADX data safely - NEW
		let entryADX = 'N/A'
		let entryADXState = 'N/A'

		if (trade.adxData && trade.adxData.success) {
			entryADX = (trade.adxData.value || 0).toFixed(2)
			entryADXState = trade.adxData.marketState || 'UNKNOWN'
		}

		// =============================================
		// Write to trades.csv (detailed)
		// =============================================

		const tradeRow = [
			trade.exitTime,
			trade.side,
			trade.entryPrice.toFixed(2),
			trade.exitPrice.toFixed(2),
			trade.size.toFixed(4),
			trade.grossPnL.toFixed(2),
			(trade.fee || 0).toFixed(2),
			trade.netPnL.toFixed(2),
			trade.entryTime,
			trade.entryReason || '',
			trade.exitReason || '',
			(trade.confidence || 0).toFixed(2),
			holdingHours.toFixed(2),
			entryVolumeRatio,
			entryVolumeInterpretation,
			entryADX, // ADDED
			entryADXState // ADDED
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
			trade.entryPrice.toFixed(2),
			trade.exitPrice.toFixed(2),
			trade.size.toFixed(4),
			trade.grossPnL.toFixed(2),
			(trade.fee || 0).toFixed(2),
			trade.netPnL.toFixed(2),
			returnPercent.toFixed(2),
			trade.entryReason || '',
			trade.exitReason || '',
			holdingHours.toFixed(2),
			entryVolumeRatio,
			entryVolumeInterpretation,
			entryADX, // ADDED
			entryADXState // ADDED
		].join(',')

		try {
			fs.appendFileSync(this.tradeResultsFile, resultRow + '\n')
		} catch (error) {
			console.error('[TradeLogger] Failed to write trade result:', error.message)
		}

		console.log(
			`[TradeLogger] ✅ Trade logged: ${trade.side} | Entry: ${trade.entryPrice.toFixed(2)} | Exit: ${trade.exitPrice.toFixed(2)} | PnL: $${trade.netPnL.toFixed(2)} | ${holdingHours.toFixed(1)}h | Volume: ${entryVolumeInterpretation} | ADX: ${entryADX} (${entryADXState})`
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
