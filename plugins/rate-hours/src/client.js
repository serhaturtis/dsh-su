/**
 * dsh-rate-hours — client half.
 *
 * Shows whether DeepSeek is currently billing at peak or off-peak rates, and
 * how long until that changes, as a dot + short line in the composer row
 * (`conversation.input.left`).
 *
 * Shape: this file is a client-module bundle, not a module. The host serves it
 * as a plain script, so it must call `window.__ModuleLoader__.load` once and
 * register a factory; the factory body runs at materialization, not at load.
 * Everything else lives inside the factory closure for that reason.
 *
 * The schedule is computed from the browser clock, with no Host round-trip, so
 * the plugin contributes no service, registers no route, and needs no RPC. See
 * the README for the tradeoff that buys.
 */
;(function () {
	'use strict'
	if (typeof window === 'undefined' || window.__ModuleLoader__ === undefined) return

	window.__ModuleLoader__.load({
		id: 'dsh-rate-hours',
		factory: function (require) {
			var React = require('react')
			var module = { exports: {} }
			var exports = module.exports
			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

			//#region schedule
			var MIN = 60000
			/** Scan bound: a transition always exists within a week; 10 days is slack. */
			var SCAN_MINUTES = 60 * 24 * 10

			/**
			 * Peak blocks as half-open [start, end) minute ranges from 00:00 UTC.
			 * 01:00-04:00 and 06:00-10:00 UTC, Monday through Friday.
			 *
			 * Chinese public holidays are deliberately not tracked. The annual
			 * State Council table was a yearly maintenance obligation, and a
			 * forecast could silently mis-price days. The tooltip states the
			 * limitation instead of implying a completeness this badge does not
			 * have.
			 */
			var PEAK_BLOCKS = [
				[1 * 60, 4 * 60],
				[6 * 60, 10 * 60],
			]

			/** Minute of the UTC day, 0..1439. */
			function utcMinuteOfDay(ms) {
				var d = new Date(ms)
				return d.getUTCHours() * 60 + d.getUTCMinutes()
			}

			/** UTC day of week; 0 = Sunday. */
			function utcDay(ms) {
				return new Date(ms).getUTCDay()
			}

			/**
			 * Whether `ms` bills at peak rates.
			 *
			 * Weekends are off-peak all day; otherwise the UTC minute decides. A
			 * Chinese public holiday is a weekday here, so it is reported as peak.
			 */
			function isPeak(ms) {
				var day = utcDay(ms)
				if (day === 0 || day === 6) return false
				var minute = utcMinuteOfDay(ms)
				for (var i = 0; i < PEAK_BLOCKS.length; i++) {
					if (minute >= PEAK_BLOCKS[i][0] && minute < PEAK_BLOCKS[i][1]) return true
				}
				return false
			}

			/** First minute-aligned instant at or after `fromMs` whose peak-ness differs. */
			function nextTransition(fromMs) {
				var startIsPeak = isPeak(fromMs)
				var t = Math.ceil(fromMs / MIN) * MIN
				for (var i = 0; i < SCAN_MINUTES; i++) {
					if (isPeak(t) !== startIsPeak) return { at: t, toPeak: !startIsPeak }
					t += MIN
				}
				return null
			}

			/** Last minute-aligned instant before the run containing `fromMs` began. */
			function runStart(fromMs) {
				var startIsPeak = isPeak(fromMs)
				var t = Math.floor(fromMs / MIN) * MIN
				for (var i = 0; i < SCAN_MINUTES; i++) {
					t -= MIN
					if (isPeak(t) !== startIsPeak) return t + MIN
				}
				return null
			}

			/** "8h 36m", "1d 22h", "2m", "<1m". */
			function formatDuration(ms) {
				if (ms < MIN) return '<1m'
				var totalMinutes = Math.round(ms / MIN)
				var days = Math.floor(totalMinutes / 1440)
				var hours = Math.floor((totalMinutes % 1440) / 60)
				var minutes = totalMinutes % 60
				if (days > 0) return days + 'd ' + hours + 'h'
				if (hours > 0) return hours + 'h ' + minutes + 'm'
				return minutes + 'm'
			}

			/** UTC stamp for the tooltip, e.g. "2026-10-21 01:00 UTC". */
			function utcStamp(ms) {
				return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
			}

			/**
			 * The display model for one instant.
			 *
			 * @param nowMs - the instant to describe.
			 * @returns peak/class flags, the compact line, the tooltip, and the
			 *   next transition (or null when the scan finds none).
			 */
			function describe(nowMs) {
				var peak = isPeak(nowMs)
				var day = utcDay(nowMs)
				var weekend = day === 0 || day === 6
				var next = nextTransition(nowMs)

				var label
				if (peak) label = 'Peak pricing'
				else if (weekend) label = 'Weekend off-peak'
				else label = 'Off-peak'

				var countdown = ''
				if (next !== null) {
					countdown = (next.toPeak ? 'peak' : 'off-peak') + ' in ' + formatDuration(next.at - nowMs)
				}

				var lines = [
					peak ? 'DeepSeek peak rate: full price.' : 'DeepSeek off-peak rate: half of peak price.',
					'Peak: 01:00-04:00 and 06:00-10:00 UTC, Monday-Friday.',
					'Chinese public holidays are not tracked — DeepSeek bills them off-peak, so a holiday weekday shows as peak here.',
				]
				if (next !== null) lines.push((next.toPeak ? 'Peak' : 'Off-peak') + ' begins ' + utcStamp(next.at) + '.')
				lines.push('Computed from this browser clock, not the Host.')

				return {
					peak: peak,
					weekend: weekend,
					label: label,
					countdown: countdown,
					text: countdown === '' ? label : label + ' · ' + countdown,
					title: lines.join('\n'),
					nextAt: next === null ? null : next.at,
					nextIsPeak: next === null ? null : next.toPeak,
				}
			}
			//#endregion

			/** Red on peak, green on a weekend, amber otherwise. */
			function dotColor(status) {
				if (status.peak) return '#e5484d'
				if (status.weekend) return '#3fb950'
				return '#f5a524'
			}

			/**
			 * The badge. Re-renders on a one-second tick; the only state is the
			 * clock, so there is no snapshot identity to get wrong.
			 */
			function RateHours() {
				var clock = React.useState(Date.now())
				var now = clock[0]
				var setNow = clock[1]

				React.useEffect(function () {
					var timer = setInterval(function () {
						setNow(Date.now())
					}, 1000)
					return function () {
						clearInterval(timer)
					}
				}, [])

				var status = describe(now)
				return React.createElement(
					'span',
					{
						role: 'status',
						title: status.title,
						style: {
							display: 'inline-flex',
							alignItems: 'center',
							gap: '6px',
							fontSize: '12px',
							color: 'inherit',
							opacity: 0.8,
							whiteSpace: 'nowrap',
							userSelect: 'none',
						},
					},
					React.createElement('span', {
						'aria-hidden': 'true',
						style: {
							width: '7px',
							height: '7px',
							borderRadius: '50%',
							flex: '0 0 auto',
							background: dotColor(status),
						},
					}),
					React.createElement('span', null, status.text),
				)
			}

			/** Services this plugin reads. */
			var inject = ['slots']

			/**
			 * Client plugin body: one entry in the composer's left-hand row.
			 *
			 * @param ctx - client root context.
			 */
			function apply(ctx) {
				ctx.slots.inject('conversation.input.left', function () {
					return ctx.slots.register({ name: 'conversation.input.left', id: 'rate-hours', order: 10 }, RateHours)
				})
			}

			exports.apply = apply
			exports.inject = inject
			exports.RateHours = RateHours
			/** Exposed so the node tests can drive the schedule without a browser. */
			exports.__schedule = {
				PEAK_BLOCKS: PEAK_BLOCKS,
				isPeak: isPeak,
				nextTransition: nextTransition,
				runStart: runStart,
				formatDuration: formatDuration,
				describe: describe,
			}
			return module.exports
		},
	})
})()
