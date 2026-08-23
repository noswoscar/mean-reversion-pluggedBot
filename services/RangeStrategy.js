// services/RangeStrategy.js - Mean Reversion Strategy with Min Trade Size
// Calls LongService via HTTP API

const axios = require('axios')

class RangeStrategy {
	constructor(config) {
		this.config = config
		this.currentPosition = null
		this.lastEntryTime = 0
		this.entryCooldown = 30000
		this.priceHistory = []
		this.debug = config.debug || false
		this.tradeIdCounter = 0
		this.maxADXForEntry = config.maxADXForEntry || 6

		// Minimum trade size in USD
		this.minTradeSizeUSD = config.minTradeSizeUSD || 4

		// LongService API configuration
		this.longServiceUrl = config.longServiceUrl || 'http://localhost:3001'
		this.symbol = config.symbol || 'BTC/USDC'
	}

	// =============================================
	// HTTP HELPER - Call LongService API
	// =============================================

	async callLongService(endpoint, method = 'POST', data = null) {
		try {
			const url = `${this.longServiceUrl}/api/long/${endpoint}`
			const options = {
				method: method,
				url: url,
				headers: {
					'Content-Type': 'application/json'
				},
				timeout: 30000
			}

			if (data) {
				options.data = data
			}

			const response = await axios(options)
			return response.data
		} catch (error) {
			console.error(`[RangeStrategy] ❌ LongService API error (${endpoint}):`, error.message)
			if (error.response) {
				console.error('[RangeStrategy] Response:', error.response.data)
			}
			throw error
		}
	}

	// =============================================
	// MAIN DECISION
	// =============================================

	async makeDecision(data) {
		const { rsi, slowdown, price, volume, adx } = data
		const currentPrice = price.price

		this.updatePriceHistory(currentPrice)

		const decision = {
			action: 'HOLD',
			confidence: 0,
			reasons: [],
			signal: null,
			risk: null,
			positionId: null,
			adxBlocked: false
		}

		if (!rsi.success || !slowdown.success || !price.success) {
			decision.reasons = ['Missing data from services']
			return decision
		}

		// =============================================
		// STEP 2: Check if we have an OPEN position
		// =============================================

		if (this.currentPosition) {
			const exitCheck = this.checkExit(this.currentPosition, currentPrice, rsi)
			if (exitCheck.shouldExit) {
				decision.action = 'EXIT'
				decision.confidence = 1.0
				decision.reasons = exitCheck.reasons
				decision.positionId = this.currentPosition.tradeId

				await this.executeExit(decision)
				return decision
			}

			decision.reasons = [`Position already open (Trade #${this.currentPosition.tradeId}) - waiting for exit`]
			return decision
		}

		// =============================================
		// STEP 1: Check ADX - BLOCK TRADES IF ADX > 6
		// =============================================

		if (adx && adx.success) {
			if (adx.value > this.maxADXForEntry) {
				decision.reasons = [
					`⛔ ADX too high (${adx.value.toFixed(2)}) - Market trending (${adx.marketState})`,
					`Max ADX for entry: ${this.maxADXForEntry}`
				]
				decision.adxBlocked = true
				return decision
			}
		} else if (adx && !adx.success) {
			if (this.debug) {
				console.log('[RangeStrategy] ⚠️ ADX data unavailable - continuing without ADX check')
			}
		}

		// =============================================
		// STEP 3: Check cooldown
		// =============================================

		if (Date.now() - this.lastEntryTime < this.entryCooldown) {
			decision.reasons = ['Cooldown period active - waiting before next entry']
			return decision
		}

		// =============================================
		// STEP 4: Analyze signals
		// =============================================

		const rsiSignal = this.analyzeRSI(rsi)
		const slowdownSignal = this.analyzeSlowdown(slowdown, currentPrice)
		const priceActionSignal = this.analyzePriceAction(currentPrice)

		const combined = this.combineSignals(rsiSignal, slowdownSignal, priceActionSignal)

		const confidenceResult = this.calculateConfidence(
			rsiSignal,
			slowdownSignal,
			priceActionSignal,
			combined,
			volume,
			adx
		)

		decision.confidence = confidenceResult.confidence

		// =============================================
		// STEP 5: Check if we should enter (LONG ONLY)
		// =============================================

		// Ignore SELL/SHORT signals - ONLY trade LONG
		if (combined.action === 'SELL') {
			decision.reasons = ['⏭️ Ignoring SHORT signal - LONG only strategy']
			return decision
		}

		if (
			confidenceResult.confidence >= this.config.minConfidence &&
			combined.action === 'BUY' && // Only allow BUY (LONG)
			this.currentPosition === null
		) {
			const signal = this.generateSignal(combined, currentPrice)
			if (signal) {
				decision.action = signal.action
				decision.reasons = confidenceResult.reasons
				decision.signal = signal
				decision.risk = this.calculateRisk(currentPrice, signal.direction)
				this.lastEntryTime = Date.now()

				if (adx && adx.success) {
					signal.adxData = {
						value: adx.value,
						state: adx.marketState
					}
				}

				await this.executeEntry(decision)
				return decision
			}
		}

		decision.reasons = this.getHoldReasons(rsiSignal, slowdownSignal, priceActionSignal, confidenceResult)
		return decision
	}

	// =============================================
	// EXECUTE ENTRY VIA LONGSERVICE HTTP API
	// =============================================

	async executeEntry(decision) {
		try {
			const { signal, risk } = decision
			// Use the amount from config or from risk calculation
			const amountUSD = risk.positionValue || 4

			console.log(`[RangeStrategy] 📈 Opening position: ${this.symbol} with $${amountUSD.toFixed(2)}`)
			console.log(`[RangeStrategy] Entry price: $${signal.entryPrice}`)

			// Call LongService /open endpoint
			const result = await this.callLongService('open', 'POST', {
				symbol: this.symbol,
				amountUSD: parseFloat(amountUSD)
			})

			if (result.success) {
				const tradeData = result.data

				// Store position with trade details from LongService
				const position = {
					tradeId: tradeData.tradeId,
					orderId: tradeData.orderId,
					side: signal.direction,
					entryPrice: signal.entryPrice,
					positionSize: risk.positionSize,
					positionValue: risk.positionValue,
					btcAmount: tradeData.btcAmount,
					stopLoss: risk.stopLoss,
					takeProfit: risk.takeProfit,
					entryTime: new Date().toISOString(),
					longServiceTradeId: tradeData.tradeId
				}

				this.setPosition(position)
				console.log(`[RangeStrategy] ✅ Position opened! Trade ID: ${tradeData.tradeId}`)
				console.log(`[RangeStrategy] BTC Amount: ${tradeData.btcAmount}`)
			} else {
				console.error('[RangeStrategy] ❌ Failed to open position:', result.error || 'Unknown error')
			}
		} catch (error) {
			console.error('[RangeStrategy] ❌ Error opening position:', error.message)
		}
	}

	// =============================================
	// EXECUTE EXIT VIA LONGSERVICE HTTP API
	// =============================================

	async executeExit(decision) {
		if (!this.currentPosition) {
			console.warn('[RangeStrategy] ⚠️ No position to close')
			return
		}

		try {
			const position = this.currentPosition
			const btcAmount = position.btcAmount || position.positionSize

			console.log(`[RangeStrategy] 📉 Closing position: ${this.symbol} - ${btcAmount} BTC`)
			console.log(`[RangeStrategy] Entry price: $${position.entryPrice}`)
			console.log(`[RangeStrategy] Reason: ${decision.reasons.join('; ')}`)

			// Call LongService /close endpoint
			const result = await this.callLongService('close', 'POST', {
				symbol: this.symbol,
				btcAmount: parseFloat(btcAmount),
				entryPrice: parseFloat(position.entryPrice)
			})

			if (result.success) {
				const tradeData = result.data
				console.log(`[RangeStrategy] ✅ Position closed! Trade ID: ${tradeData.tradeId}`)
				console.log(`[RangeStrategy] Exit Price: $${tradeData.exitPrice}`)
				console.log(`[RangeStrategy] PnL: $${tradeData.pnl.toFixed(2)}`)

				this.clearPosition()
			} else {
				console.error('[RangeStrategy] ❌ Failed to close position:', result.error || 'Unknown error')
			}
		} catch (error) {
			console.error('[RangeStrategy] ❌ Error closing position:', error.message)
		}
	}

	// =============================================
	// PRICE HISTORY TRACKING
	// =============================================

	updatePriceHistory(price) {
		this.priceHistory.push({ price, timestamp: Date.now() })
		if (this.priceHistory.length > 100) {
			this.priceHistory.shift()
		}
	}

	// =============================================
	// PRICE ACTION ANALYSIS
	// =============================================

	analyzePriceAction(currentPrice) {
		if (this.priceHistory.length < 10) {
			return {
				isPeaking: false,
				isBottoming: false,
				momentum: 'NEUTRAL',
				strength: 0
			}
		}

		const recentPrices = this.priceHistory.slice(-10).map((p) => p.price)
		const oldestPrice = recentPrices[0]
		const priceChange = ((currentPrice - oldestPrice) / oldestPrice) * 100

		const last5 = recentPrices.slice(-5)
		const first5 = recentPrices.slice(0, 5)
		const avgLast5 = last5.reduce((a, b) => a + b, 0) / last5.length
		const avgFirst5 = first5.reduce((a, b) => a + b, 0) / first5.length
		const isSlowing = Math.abs(avgLast5 - avgFirst5) < Math.abs(avgLast5 - oldestPrice) * 0.3

		const isPeaking = priceChange > 0.1 && isSlowing && last5[last5.length - 1] < last5[last5.length - 2]
		const isBottoming = priceChange < -0.1 && isSlowing && last5[last5.length - 1] > last5[last5.length - 2]

		let momentum = 'NEUTRAL'
		let strength = 0

		if (priceChange > 0.3) {
			momentum = 'BULLISH'
			strength = 0.15
		} else if (priceChange < -0.3) {
			momentum = 'BEARISH'
			strength = 0.15
		}

		if (isPeaking) {
			momentum = 'PEAKING'
			strength = 0.25
		} else if (isBottoming) {
			momentum = 'BOTTOMING'
			strength = 0.25
		}

		return {
			isPeaking,
			isBottoming,
			momentum,
			strength,
			priceChange
		}
	}

	// =============================================
	// RSI ANALYSIS
	// =============================================

	analyzeRSI(rsiData) {
		const rsi = rsiData.currentRsi
		const status = rsiData.status
		const trend = rsiData.rsiTrend || 'FLAT'

		const { rsiOverbought, rsiOversold, rsiExtremeOverbought, rsiExtremeOversold } = this.config

		const isOverbought = status === 'EXTREME_OVERBOUGHT' || status === 'OVERBOUGHT' || rsi > rsiOverbought
		const isOversold = status === 'EXTREME_OVERSOLD' || status === 'OVERSOLD' || rsi < rsiOversold
		const isExtremeOverbought = status === 'EXTREME_OVERBOUGHT' || rsi > rsiExtremeOverbought
		const isExtremeOversold = status === 'EXTREME_OVERSOLD' || rsi < rsiExtremeOversold
		const isFalling = trend === 'FALLING'
		const isRising = trend === 'RISING'

		console.log('RSI Analysis:', { rsi, status, trend })
		console.log('isFalling', isFalling)
		let strength = 0
		let reason = []

		if (isExtremeOverbought) {
			strength = 0.2
			reason = [`RSI extreme overbought (${rsi.toFixed(1)})`]
		} else if (isExtremeOversold) {
			strength = 0.2
			reason = [`RSI extreme oversold (${rsi.toFixed(1)})`]
		} else if (isOverbought) {
			strength = 0.15
			reason = [`RSI overbought (${rsi.toFixed(1)})`]
		} else if (isOversold) {
			strength = 0.15
			reason = [`RSI oversold (${rsi.toFixed(1)})`]
		} else {
			strength = 0.05
			reason = [`RSI neutral (${rsi.toFixed(1)})`]
		}

		return {
			action: 'HOLD',
			strength: strength,
			reason: reason,
			rsi: rsi,
			status: status,
			trend: trend,
			isOverbought,
			isOversold,
			isExtremeOverbought,
			isExtremeOversold,
			isFalling,
			isRising
		}
	}

	// =============================================
	// SLOWDOWN ANALYSIS
	// =============================================

	analyzeSlowdown(slowdownData, currentPrice) {
		const detected = slowdownData.detected || false

		let score = slowdownData.strongestScore || 0
		let tf = slowdownData.strongestTimeframe || 'none'
		let isSignificant = slowdownData.isSignificant || false
		let summary = slowdownData.strongestSummary || 'No slowdown'

		const strongest = slowdownData.strongestSlowdown || null
		if (strongest) {
			if (score === 0) {
				score = strongest.slowdownScore || strongest.score || 0
			}
			if (tf === 'none') {
				tf = strongest.timeframe || 'none'
			}
			if (!isSignificant) {
				isSignificant = strongest.isSignificant || false
			}
			if (summary === 'No slowdown') {
				summary = strongest.summary || 'Slowdown detected'
			}
		}

		if (score === 0 && slowdownData.timeframes && slowdownData.timeframes.length > 0) {
			let maxScore = 0
			let maxTf = 'none'
			let maxSignificant = false

			for (const tfData of slowdownData.timeframes) {
				const tfScore = tfData.slowdownScore || tfData.score || 0
				if (tfScore > maxScore) {
					maxScore = tfScore
					maxTf = tfData.timeframe || 'none'
					maxSignificant = tfData.isSignificant || false
				}
			}

			if (maxScore > 0) {
				score = maxScore
				tf = maxTf
				isSignificant = maxSignificant
				summary = `Slowdown detected in ${maxTf} (score: ${maxScore.toFixed(2)})`
			}
		}

		if (detected && score > 0) {
			const relevantTimeframes = this.config.slowdownTimeframes || ['10s', '30s', '1m', '5m', '15m', '1h', '4h']
			const isRelevant = relevantTimeframes.includes(tf)
			const threshold = this.config.slowdownSignificanceThreshold || 0.12
			const isSignificantCalc = score > threshold && isRelevant
			const finalSignificant = isSignificant || isSignificantCalc

			if (finalSignificant && isRelevant) {
				return { detected, isSignificant: true, timeframe: tf, summary: summary, score: score }
			}

			if (score > 0.05 && isRelevant) {
				return { detected, isSignificant: false, timeframe: tf, summary: 'Weak slowdown', score: score }
			}
		}

		return { detected, isSignificant: false, timeframe: 'none', summary: 'No slowdown', score: 0 }
	}

	// =============================================
	// COMBINE SIGNALS
	// =============================================

	combineSignals(rsiSignal, slowdownSignal, priceActionSignal) {
		const { isSignificant, timeframe, score } = slowdownSignal
		const { isOverbought, isOversold, isExtremeOverbought, isExtremeOversold } = rsiSignal
		const { isPeaking, isBottoming } = priceActionSignal

		if (isSignificant && isOverbought) {
			const strength = isExtremeOverbought ? 0.9 : 0.8
			const reasons = [
				`🔴 SLOWDOWN (${timeframe}, score: ${score.toFixed(2)})`,
				`RSI ${isExtremeOverbought ? 'EXTREME ' : ''}overbought (${rsiSignal.rsi.toFixed(1)})`,
				'⏰ Entering BEFORE RSI reversal'
			]
			if (isPeaking) reasons.push('📉 Price peaking')
			return { action: 'SELL', strength: strength, reason: reasons }
		}

		if (isSignificant && isOversold) {
			const strength = isExtremeOversold ? 0.9 : 0.8
			const reasons = [
				`🟢 SLOWDOWN (${timeframe}, score: ${score.toFixed(2)})`,
				`RSI ${isExtremeOversold ? 'EXTREME ' : ''}oversold (${rsiSignal.rsi.toFixed(1)})`,
				'⏰ Entering BEFORE RSI reversal'
			]
			if (isBottoming) reasons.push('📈 Price bottoming')
			return { action: 'BUY', strength: strength, reason: reasons }
		}

		return { action: 'HOLD', strength: 0, reason: ['No signal'] }
	}

	// =============================================
	// CONFIDENCE CALCULATION
	// =============================================

	calculateConfidence(rsiSignal, slowdownSignal, priceActionSignal, combined, volumeSignal, adxSignal) {
		let confidence = 0
		const reasons = []

		// SLOWDOWN = PRIMARY SIGNAL (50% weight)
		if (slowdownSignal.isSignificant) {
			confidence += 0.5
			reasons.push(
				`🚀 Significant slowdown (${slowdownSignal.timeframe}, score: ${(slowdownSignal.score || 0).toFixed(2)})`
			)
		} else if (slowdownSignal.detected && slowdownSignal.score > 0.05) {
			confidence += 0.15
			reasons.push(`Slowdown detected (${slowdownSignal.timeframe}, score: ${(slowdownSignal.score || 0).toFixed(2)})`)
		}

		// RSI = CONFIRMATION (20% weight)
		if (rsiSignal.isExtremeOverbought || rsiSignal.isExtremeOversold) {
			confidence += 0.2
			reasons.push(...rsiSignal.reason)
		} else if (rsiSignal.isOverbought || rsiSignal.isOversold) {
			confidence += 0.15
			reasons.push(...rsiSignal.reason)
		} else {
			confidence += 0.05
			reasons.push(...rsiSignal.reason)
		}

		// PRICE ACTION = CONFIRMATION (15% weight)
		if (priceActionSignal.isPeaking) {
			confidence += 0.15
			reasons.push('📉 Price action confirms peaking')
		} else if (priceActionSignal.isBottoming) {
			confidence += 0.15
			reasons.push('📈 Price action confirms bottoming')
		}

		// VOLUME = CONFIRMATION (10% weight)
		if (volumeSignal && volumeSignal.success && volumeSignal.data) {
			const interpretation = volumeSignal.data.interpretation || 'NORMAL'
			const volumeRatio = volumeSignal.data.volumeRatio || 1

			if (interpretation === 'HIGH' || volumeRatio > 1.5) {
				confidence -= 0.2
				reasons.push(`⚠️ HIGH VOLUME (${volumeRatio.toFixed(1)}x avg) - BREAKOUT RISK`)
			} else if (interpretation === 'LOW' || volumeRatio < 0.7) {
				confidence += 0.1
				reasons.push(`📊 LOW VOLUME (${volumeRatio.toFixed(1)}x avg) - range likely to hold`)
			} else {
				confidence += 0.05
				reasons.push(`📊 Normal volume (${volumeRatio.toFixed(1)}x avg)`)
			}
		} else {
			reasons.push('📊 No volume data available')
		}

		// ADX = CONFIRMATION (5% weight)
		if (adxSignal && adxSignal.success) {
			const adx = adxSignal.value
			const state = adxSignal.marketState || 'UNKNOWN'

			if (adx <= 6) {
				confidence += 0.15
				reasons.push(`✅ Low ADX (${adx.toFixed(2)}) - Range market (${state})`)
			} else if (adx <= 15) {
				confidence += 0.05
				reasons.push(`📊 Moderate ADX (${adx.toFixed(2)}) - ${state}`)
			} else {
				confidence -= 0.3
				reasons.push(`⚠️ High ADX (${adx.toFixed(2)}) - ${state}`)
			}
		} else if (adxSignal && !adxSignal.success) {
			reasons.push('❓ No ADX data available')
		}

		// SIGNAL CONFIRMATION BONUS
		if (combined.strength > 0.7) {
			confidence += 0.1
			reasons.push('Strong signal confirmation')
		}

		confidence = Math.min(confidence, 1.0)
		confidence = Math.max(confidence, 0.0)

		return {
			confidence: Math.round(confidence * 100) / 100,
			reasons: reasons.length > 0 ? reasons : ['No clear signal']
		}
	}

	// =============================================
	// GENERATE SIGNAL
	// =============================================

	generateSignal(combined, currentPrice) {
		if (combined.action === 'BUY') {
			return {
				action: 'BUY',
				direction: 'LONG',
				entryPrice: currentPrice,
				confidence: combined.strength,
				reason: combined.reason.join('; ')
			}
		}

		if (combined.action === 'SELL') {
			return {
				action: 'SELL',
				direction: 'SHORT',
				entryPrice: currentPrice,
				confidence: combined.strength,
				reason: combined.reason.join('; ')
			}
		}

		return null
	}

	// =============================================
	// RISK MANAGEMENT - Account Balance with $4 Minimum
	// =============================================

	calculateRisk(currentPrice, direction) {
		// Calculate position size based on account balance
		const riskAmount = this.config.accountBalance * this.config.maxRiskPerTrade
		const stopDistance = currentPrice * this.config.stopLossPercent

		// Calculate position size in BTC
		let positionSize = riskAmount / stopDistance

		// Calculate the USD value of this position
		let positionValue = positionSize * currentPrice

		// Check if position value is less than minimum trade size ($4)
		if (positionValue < this.minTradeSizeUSD) {
			// Use minimum trade size
			positionValue = this.minTradeSizeUSD
			positionSize = positionValue / currentPrice
			console.log(
				`[RangeStrategy] ⚠️ Position size ($${positionValue.toFixed(2)}) below minimum, using minimum $${this.minTradeSizeUSD}`
			)
		}

		// Cap position to prevent over-trading (max 20% of account)
		const maxPositionValue = this.config.accountBalance * 0.2
		if (positionValue > maxPositionValue) {
			positionValue = maxPositionValue
			positionSize = positionValue / currentPrice
			console.log(`[RangeStrategy] ⚠️ Position size capped at $${maxPositionValue.toFixed(2)} (20% of account)`)
		}

		const takeProfitDistance = currentPrice * this.config.takeProfitPercent

		return {
			positionSize: parseFloat(positionSize.toFixed(8)), // BTC amount
			positionValue: parseFloat(positionValue.toFixed(2)), // USD value
			stopDistance: stopDistance,
			takeProfitDistance: takeProfitDistance,
			stopLoss: direction === 'LONG' ? currentPrice - stopDistance : currentPrice + stopDistance,
			takeProfit: direction === 'LONG' ? currentPrice + takeProfitDistance : currentPrice - takeProfitDistance,
			riskAmount: parseFloat((positionValue * this.config.stopLossPercent).toFixed(2)),
			riskPercent: this.config.maxRiskPerTrade * 100,
			minTradeApplied: positionValue === this.minTradeSizeUSD // Flag if min was used
		}
	}

	// =============================================
	// EXIT CONDITIONS
	// =============================================

	checkExit(position, currentPrice, rsiData) {
		const reasons = []
		let shouldExit = false

		const rsi = rsiData.currentRsi
		const status = rsiData.status
		const trend = rsiData.rsiTrend || 'FLAT'

		const isOverbought = status === 'EXTREME_OVERBOUGHT' || status === 'OVERBOUGHT'
		const isOversold = status === 'EXTREME_OVERSOLD' || status === 'OVERSOLD'
		const isFalling = trend === 'FALLING'
		const isRising = trend === 'RISING'

		// EXIT 1: Opposite RSI Extreme
		if (position.side === 'LONG' && isOverbought && isFalling) {
			shouldExit = true
			reasons.push(`✅ RSI overbought (${rsi.toFixed(1)}) with falling trend - taking profit`)
			return { shouldExit, reasons }
		}

		if (position.side === 'SHORT' && isOversold && isRising) {
			shouldExit = true
			reasons.push(`✅ RSI oversold (${rsi.toFixed(1)}) with rising trend - taking profit`)
			return { shouldExit, reasons }
		}

		// EXIT 2: Stop Loss
		if (position.side === 'LONG' && currentPrice <= position.stopLoss) {
			shouldExit = true
			reasons.push(`🛑 Stop loss hit at ${currentPrice.toFixed(2)}`)
			return { shouldExit, reasons }
		}

		if (position.side === 'SHORT' && currentPrice >= position.stopLoss) {
			shouldExit = true
			reasons.push(`🛑 Stop loss hit at ${currentPrice.toFixed(2)}`)
			return { shouldExit, reasons }
		}

		// EXIT 3: Take Profit
		if (position.side === 'LONG' && currentPrice >= position.takeProfit) {
			shouldExit = true
			reasons.push(`🎯 Take profit hit at ${currentPrice.toFixed(2)}`)
			return { shouldExit, reasons }
		}

		if (position.side === 'SHORT' && currentPrice <= position.takeProfit) {
			shouldExit = true
			reasons.push(`🎯 Take profit hit at ${currentPrice.toFixed(2)}`)
			return { shouldExit, reasons }
		}

		// EXIT 4: Max Holding Time
		const entryTime = new Date(position.entryTime).getTime()
		const now = Date.now()
		const hoursHeld = (now - entryTime) / (1000 * 60 * 60)

		if (hoursHeld > this.config.maxHoldingHours) {
			shouldExit = true
			reasons.push(`⏰ Max holding time reached (${hoursHeld.toFixed(1)} hours)`)
			return { shouldExit, reasons }
		}

		return {
			shouldExit: false,
			reasons: ['No exit signal - holding position']
		}
	}

	// =============================================
	// GET HOLD REASONS
	// =============================================

	getHoldReasons(rsiSignal, slowdownSignal, priceActionSignal, confidenceResult) {
		const reasons = []

		if (rsiSignal.rsi > 40 && rsiSignal.rsi < 60) {
			reasons.push(...rsiSignal.reason)
		}

		if (slowdownSignal.detected && !slowdownSignal.isSignificant) {
			reasons.push(
				`Weak slowdown only (${slowdownSignal.timeframe}, score: ${(slowdownSignal.score || 0).toFixed(2)}) - waiting for stronger signal`
			)
		}

		if (!slowdownSignal.detected && !priceActionSignal.isPeaking && !priceActionSignal.isBottoming) {
			reasons.push('No slowdown detected - waiting for momentum to fade')
		}

		if (confidenceResult.confidence < this.config.minConfidence) {
			reasons.push(
				`Confidence too low (${(confidenceResult.confidence * 100).toFixed(0)}% < ${(this.config.minConfidence * 100).toFixed(0)}%)`
			)
		}

		if (reasons.length === 0) {
			reasons.push('No trade signal')
		}

		return reasons
	}

	// =============================================
	// POSITION MANAGEMENT
	// =============================================

	setPosition(position) {
		position.tradeId = ++this.tradeIdCounter
		this.currentPosition = position
		if (this.debug) {
			console.log(`[RangeStrategy] Position #${position.tradeId} set`)
		}
	}

	getPosition() {
		return this.currentPosition
	}

	clearPosition() {
		this.currentPosition = null
		if (this.debug) {
			console.log('[RangeStrategy] Position cleared')
		}
	}

	hasPosition() {
		return this.currentPosition !== null
	}

	calculatePnL(position, exitPrice) {
		const entry = position.entryPrice
		const size = position.positionSize || position.size

		if (position.side === 'LONG') {
			return (exitPrice - entry) * size
		} else {
			return (entry - exitPrice) * size
		}
	}
}

module.exports = RangeStrategy
