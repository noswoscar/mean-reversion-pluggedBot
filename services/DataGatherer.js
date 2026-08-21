// services/DataGatherer.js - Fetches data from microservices with proper slowdown mapping

const axios = require('axios')

class DataGatherer {
	constructor(config) {
		this.config = config
		this.rsiServiceUrl = config.rsiServiceUrl
		this.slowdownServiceUrl = config.slowdownServiceUrl
		this.priceServiceUrl = config.priceServiceUrl
		this.volumeServiceUrl = config.volumeServiceUrl
		this.adxServiceUrl = config.adxServiceUrl || 'http://localhost:7017' // ADDED
		this.timeout = config.timeout || 5000
		this.debug = config.debug || false
	}

	// =============================================
	// GATHER ALL DATA
	// =============================================

	async gatherAllData() {
		try {
			const [rsiData, slowdownData, priceData, volumeData, adxData] = await Promise.all([
				this.getRSIData(),
				this.getSlowdownData(),
				this.getCurrentPrice(),
				this.getVolumeData(),
				this.getADXData() // ADDED
			])

			// Log what we got
			if (this.debug) {
				console.log(`[DataGatherer] RSI: ${rsiData.success ? rsiData.currentRsi : 'FAIL'}`)
				console.log(
					`[DataGatherer] Slowdown: ${slowdownData.success ? `detected=${slowdownData.detected}, score=${slowdownData.strongestScore}` : 'FAIL'}`
				)
				console.log(`[DataGatherer] Price: ${priceData.success ? priceData.price : 'FAIL'}`)
				console.log(`[DataGatherer] Volume: ${volumeData.success ? volumeData.data.interpretation : 'FAIL'}`)
				console.log(
					`[DataGatherer] ADX: ${adxData.success ? `${adxData.value.toFixed(2)} (${adxData.marketState})` : 'FAIL'}`
				) // ADDED
			}

			return {
				success: true,
				rsi: rsiData,
				slowdown: slowdownData,
				price: priceData,
				volume: volumeData,
				adx: adxData, // ADDED
				timestamp: new Date().toISOString()
			}
		} catch (error) {
			return {
				success: false,
				error: error.message,
				timestamp: new Date().toISOString()
			}
		}
	}

	// =============================================
	// GET RSI DATA
	// =============================================

	async getRSIData(range = '1h') {
		try {
			const response = await axios.get(`${this.rsiServiceUrl}/api/rsi/current?range=${range}`, {
				timeout: this.timeout
			})

			if (response.data.success) {
				const data = response.data.data
				return {
					success: true,
					currentRsi: data.currentRsi,
					status: data.status,
					rsiTrend: data.rsiTrend || 'FLAT',
					dataPoints: data.dataPoints,
					signal: data.tradeSignal,
					confidence: data.confidence
				}
			}
			return { success: false, error: response.data.error }
		} catch (error) {
			return { success: false, error: error.message }
		}
	}

	// =============================================
	// GET SLOWDOWN DATA - FIXED WITH PROPER SCORE MAPPING
	// =============================================

	async getSlowdownData(range = '1h') {
		try {
			const response = await axios.get(`${this.slowdownServiceUrl}/api/slowdown/current?range=${range}`, {
				timeout: this.timeout
			})

			if (response.data.success) {
				const data = response.data.data

				// Extract the strongest slowdown with all fields
				const strongest = data.strongestSlowdown || null

				// ⭐ CRITICAL FIX: Properly extract score from the API response
				// The API returns 'slowdownScore' in the result object
				let strongestScore = 0
				let strongestTimeframe = 'none'
				let isSignificant = false
				let strongestSummary = 'No slowdown'

				if (strongest) {
					// Try multiple field names that the API might use
					strongestScore = strongest.slowdownScore || strongest.score || 0
					strongestTimeframe = strongest.timeframe || 'none'
					isSignificant = strongest.isSignificant || false
					strongestSummary = strongest.summary || 'Slowdown detected'
				}

				// If we have timeframes data, find the highest score
				if (data.timeframes && data.timeframes.length > 0 && strongestScore === 0) {
					let maxScore = 0
					let maxTf = 'none'
					let maxSignificant = false

					for (const tf of data.timeframes) {
						const score = tf.slowdownScore || tf.score || 0
						if (score > maxScore) {
							maxScore = score
							maxTf = tf.timeframe || 'none'
							maxSignificant = tf.isSignificant || false
						}
					}

					if (maxScore > 0) {
						strongestScore = maxScore
						strongestTimeframe = maxTf
						isSignificant = maxSignificant
						strongestSummary = `Slowdown detected in ${maxTf} (score: ${maxScore.toFixed(2)})`
					}
				}

				// Log what we found
				if (this.debug) {
					console.log(
						`[DataGatherer] Slowdown: detected=${data.detected}, strongest=${strongestTimeframe} (score: ${strongestScore}, significant: ${isSignificant})`
					)
				}

				return {
					success: true,
					detected: data.detected || false,
					currentPrice: data.currentPrice || 0,
					// Raw data
					strongestSlowdown: strongest,
					timeframes: data.timeframes || [],
					// ⭐ EXTRACTED FIELDS for easy access
					strongestScore: strongestScore,
					strongestTimeframe: strongestTimeframe,
					isSignificant: isSignificant,
					strongestSummary: strongestSummary
				}
			}

			return {
				success: false,
				error: response.data.error,
				detected: false,
				strongestScore: 0,
				strongestTimeframe: 'none',
				isSignificant: false,
				strongestSummary: 'No slowdown',
				timeframes: []
			}
		} catch (error) {
			console.error('[DataGatherer] Slowdown error:', error.message)
			return {
				success: false,
				error: error.message,
				detected: false,
				strongestScore: 0,
				strongestTimeframe: 'none',
				isSignificant: false,
				strongestSummary: 'No slowdown',
				timeframes: []
			}
		}
	}

	// =============================================
	// GET SLOWDOWN FOR SPECIFIC TIMEFRAME
	// =============================================

	async getSlowdownForTimeframe(timeframe = '1m', range = '1h') {
		try {
			const response = await axios.get(
				`${this.slowdownServiceUrl}/api/slowdown/timeframe/${timeframe}?range=${range}`,
				{ timeout: this.timeout }
			)

			if (response.data.success) {
				const data = response.data.data
				return {
					success: true,
					timeframe: data.timeframe,
					detected: data.detected || false,
					isSignificant: data.isSignificant || false,
					score: data.slowdownScore || data.score || 0,
					summary: data.summary || 'No slowdown'
				}
			}
			return { success: false, error: response.data.error }
		} catch (error) {
			return { success: false, error: error.message }
		}
	}

	// =============================================
	// GET VOLUME DATA
	// =============================================

	async getVolumeData() {
		try {
			const response = await axios.get(`${this.volumeServiceUrl}/api/volume/current`, { timeout: this.timeout })

			if (response.data.success) {
				return response.data
			}
			return {
				success: false,
				error: response.data.error || 'Failed to get volume',
				data: { interpretation: 'UNKNOWN' }
			}
		} catch (error) {
			return {
				success: false,
				error: error.message,
				data: { interpretation: 'UNKNOWN' }
			}
		}
	}

	// =============================================
	// GET CURRENT PRICE
	// =============================================

	async getCurrentPrice() {
		try {
			const response = await axios.get(`${this.priceServiceUrl}/api/prices/stored/current`, { timeout: this.timeout })

			if (response.data.success) {
				return {
					success: true,
					price: response.data.data.price,
					timestamp: response.data.data.timestamp
				}
			}
			return { success: false, error: response.data.error }
		} catch (error) {
			return { success: false, error: error.message }
		}
	}

	// =============================================
	// GET PRICE HISTORY (for price action analysis)
	// =============================================

	async getPriceHistory(range = '1h') {
		try {
			const response = await axios.get(`${this.priceServiceUrl}/api/prices/stored?range=${range}`, {
				timeout: this.timeout
			})

			if (response.data.success) {
				return {
					success: true,
					prices: response.data.data,
					count: response.data.count
				}
			}
			return { success: false, error: response.data.error }
		} catch (error) {
			return { success: false, error: error.message }
		}
	}

	// =============================================
	// GET ADX DATA - NEW
	// =============================================

	async getADXData() {
		try {
			const response = await axios.get(`${this.adxServiceUrl}/api/adx/current`, {
				timeout: this.timeout
			})

			if (response.data && response.data.value !== undefined) {
				return {
					success: true,
					value: response.data.value,
					plusDI: response.data.plusDI || 0,
					minusDI: response.data.minusDI || 0,
					dx: response.data.dx || response.data.value,
					marketState: response.data.marketState || 'UNKNOWN',
					timestamp: response.data.timestamp || new Date().toISOString()
				}
			}
			return {
				success: false,
				error: 'Invalid ADX response',
				value: 0,
				marketState: 'UNKNOWN'
			}
		} catch (error) {
			console.error('[DataGatherer] ADX error:', error.message)
			return {
				success: false,
				error: error.message,
				value: 0,
				marketState: 'UNKNOWN'
			}
		}
	}

	// =============================================
	// HEALTH CHECK
	// =============================================

	async healthCheck() {
		try {
			const [rsi, slowdown, price, adx] = await Promise.all([
				axios.get(`${this.rsiServiceUrl}/health`, { timeout: 2000 }),
				axios.get(`${this.slowdownServiceUrl}/health`, { timeout: 2000 }),
				axios.get(`${this.priceServiceUrl}/health`, { timeout: 2000 }),
				axios.get(`${this.adxServiceUrl}/health`, { timeout: 2000 }) // ADDED
			])

			return {
				status: 'healthy',
				services: {
					rsi: rsi.status === 200,
					slowdown: slowdown.status === 200,
					price: price.status === 200,
					adx: adx.status === 200 // ADDED
				}
			}
		} catch (error) {
			return {
				status: 'unhealthy',
				error: error.message
			}
		}
	}
}

module.exports = DataGatherer
