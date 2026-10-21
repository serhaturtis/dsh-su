/**
 * dsh-status-widget — client half.
 *
 * A floating card in the shell overlay: the account balance, the DeepSeek rate
 * class, and a mascot you can drag around. A client-module bundle, so this
 * script calls window.__ModuleLoader__.load once and everything else lives in
 * the factory closure.
 *
 * The schedule block below is intentionally a copy of the one in
 * plugins/rate-hours/src/client.js. Client bundles cannot require each other
 * without declaring a cross-plugin dependency, and a plugin that only works
 * when another is enabled is the worse trade. test/schedule-parity.test.mjs
 * drives both copies and fails if they ever disagree.
 */
;(function () {
	'use strict'
	if (typeof window === 'undefined' || window.__ModuleLoader__ === undefined) return

	window.__ModuleLoader__.load({
		id: 'dsh-status-widget',
		factory: function (require) {
			var React = require('react')
			var module = { exports: {} }
			var exports = module.exports
			Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

			var PACK_BASE = '/dsh-status-widget'
			var BALANCE_PATH = '/dsh-status-widget/balance'
			var PREFS_PATH = '/dsh-status-widget/prefs'
			var COLLAPSE_KEY = 'dsh-status-widget:collapsed'
			var PLACEMENT_KEY = 'dsh-status-widget:placement:v1'
			var BALANCE_POLL_MS = 60000
			var EDGE = 16
			// Docked her inset from the window edge, so she reads as standing
			// beside the page rather than glued to it. The bubble grows inward from
			// her edge and is what the viewport constrains, not her position.
			var DOCK_MARGIN = 32
			/**
			 * The widget's layout frame: a fixed width, always. The character and the
			 * bubble are both centred inside it, so docking moves the frame and
			 * nothing else — the bubble keeps one shape in every mode, and she keeps
			 * one position inside it.
			 */
			// The frame equals the bubble's cap: the bubble can then never exceed the
			// frame, so docking keeps it inside the margin without changing its shape.
			var BUBBLE_MAX = 220
			var FRAME_WIDTH = BUBBLE_MAX
			var CLICK_SLOP = 4
			var MASCOT_PATH = '/dsh-status-widget/mascot.png'

			//#region schedule
			var MIN = 60000
			var BEIJING_OFFSET = 8 * 3600000
			var SCAN_MINUTES = 60 * 24 * 10

			/**
			 * Half-open [start, end) minute ranges from 00:00 UTC.
			 *
			 * Source of truth: https://api-docs.deepseek.com/quick_start/pricing
			 * ("Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through
			 * Friday, excluding Chinese public holidays"). If DeepSeek moves them,
			 * this array and the one in the sibling plugin both change, and
			 * schedule-parity.test.mjs fails until they agree.
			 */
			var PEAK_BLOCKS = [
				[1 * 60, 4 * 60],
				[6 * 60, 10 * 60],
			]

			/**
			 * Chinese public holiday spans, inclusive, in Beijing dates. Source:
			 * State Council notice 国办发明电〔2025〕7号 (2025-11-04). Peak is
			 * weekdays 01:00-04:00 and 06:00-10:00 UTC excluding these days.
			 */
			var HOLIDAYS = {
				2026: [
					['2026-01-01', '2026-01-03'],
					['2026-02-15', '2026-02-23'],
					['2026-04-04', '2026-04-06'],
					['2026-05-01', '2026-05-05'],
					['2026-06-19', '2026-06-21'],
					['2026-09-25', '2026-09-27'],
					['2026-10-01', '2026-10-07'],
				],
			}

			function utcMinuteOfDay(ms) {
				var d = new Date(ms)
				return d.getUTCHours() * 60 + d.getUTCMinutes()
			}

			function utcDay(ms) {
				return new Date(ms).getUTCDay()
			}

			function beijingDate(ms) {
				return new Date(ms + BEIJING_OFFSET).toISOString().slice(0, 10)
			}

			function holidaySpan(dateKey) {
				var spans = HOLIDAYS[dateKey.slice(0, 4)]
				if (spans === undefined) return undefined
				for (var i = 0; i < spans.length; i++) {
					if (dateKey >= spans[i][0] && dateKey <= spans[i][1]) return spans[i]
				}
				return undefined
			}

			function holidayDataKnown(dateKey) {
				return Object.prototype.hasOwnProperty.call(HOLIDAYS, dateKey.slice(0, 4))
			}

			function isPeak(ms) {
				var day = utcDay(ms)
				if (day === 0 || day === 6) return false
				if (holidaySpan(beijingDate(ms)) !== undefined) return false
				var minute = utcMinuteOfDay(ms)
				for (var i = 0; i < PEAK_BLOCKS.length; i++) {
					if (minute >= PEAK_BLOCKS[i][0] && minute < PEAK_BLOCKS[i][1]) return true
				}
				return false
			}

			function nextTransition(fromMs) {
				var startIsPeak = isPeak(fromMs)
				var t = Math.ceil(fromMs / MIN) * MIN
				for (var i = 0; i < SCAN_MINUTES; i++) {
					if (isPeak(t) !== startIsPeak) return { at: t, toPeak: !startIsPeak }
					t += MIN
				}
				return null
			}

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

			function utcStamp(ms) {
				return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
			}

			function describe(nowMs) {
				var peak = isPeak(nowMs)
				var dateKey = beijingDate(nowMs)
				var span = holidaySpan(dateKey)
				var day = utcDay(nowMs)
				var weekend = day === 0 || day === 6
				var known = holidayDataKnown(dateKey)
				var next = nextTransition(nowMs)

				var label
				if (peak) label = 'Peak pricing'
				else if (span !== undefined) label = 'Holiday off-peak'
				else if (weekend) label = 'Weekend off-peak'
				else label = 'Off-peak'

				var countdown = ''
				if (next !== null) countdown = (next.toPeak ? 'peak' : 'off-peak') + ' in ' + formatDuration(next.at - nowMs)

				var lines = [
					peak ? 'DeepSeek peak rate: full price.' : 'DeepSeek off-peak rate: half of peak price.',
					'Peak: 01:00-04:00 and 06:00-10:00 UTC, Mon-Fri, excluding Chinese public holidays.',
				]
				if (next !== null) lines.push((next.toPeak ? 'Peak' : 'Off-peak') + ' begins ' + utcStamp(next.at) + '.')
				if (span !== undefined && !peak) lines.push('Chinese public holiday (' + span[0] + ' to ' + span[1] + ').')
				if (!known) lines.push('No holiday table for ' + dateKey.slice(0, 4) + ' — weekday rule only.')

				return {
					peak: peak,
					weekend: weekend,
					holiday: span !== undefined,
					holidayKnown: known,
					label: label,
					countdown: countdown,
					text: countdown === '' ? label : label + ' · ' + countdown,
					title: lines.join('\n'),
					nextAt: next === null ? null : next.at,
					nextIsPeak: next === null ? null : next.toPeak,
				}
			}
			//#endregion

			//#region balance display
			var CURRENCY_SYMBOL = { CNY: '¥', USD: '$' }

			/** "¥12.34 · $0.50" — amounts are strings, joined without arithmetic. */
			function formatBalances(balances) {
				var parts = []
				for (var i = 0; i < balances.length; i++) {
					var symbol = CURRENCY_SYMBOL[balances[i].currency]
					parts.push(symbol === undefined ? balances[i].total + ' ' + balances[i].currency : symbol + balances[i].total)
				}
				return parts.join(' · ')
			}

			/** The one-line reading plus the tooltip detail for a balance payload. */
			function readBalance(payload) {
				// The host owns this shape, but a malformed payload must render a
				// placeholder rather than throw inside the widget.
				if (payload === null) return { text: 'balance …', title: 'Reading the account balance…' }
				if (payload.ok === true) {
					var lines = [payload.available ? 'Account can serve requests.' : 'Account balance is insufficient for API calls.']
					for (var i = 0; i < payload.balances.length; i++) {
						var b = payload.balances[i]
						lines.push(b.total + ' ' + b.currency + ' total')
						if (b.granted !== undefined) lines.push('  ' + b.granted + ' granted')
						if (b.toppedUp !== undefined) lines.push('  ' + b.toppedUp + ' topped up')
					}
					lines.push('Read ' + new Date(payload.at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC, cached 60s.')
					return { text: formatBalances(payload.balances), title: lines.join('\n') }
				}
				if (payload.reason === 'no-key') {
					return {
						text: 'no API key',
						title:
							'No DEEPSEEK_API_KEY in the credential store.\nSet it in Settings → Models, or export it before starting the Host.',
					}
				}
				return {
					text: 'balance ?',
					title: 'Balance unavailable (' + String(payload.reason) + ').\nThe widget retries once a minute.',
				}
			}
			//#endregion

			/** Red on peak, green when the whole day is off-peak, amber otherwise. */
			function dotColor(status) {
				if (status.peak) return '#e5484d'
				if (status.holiday || status.weekend) return '#3fb950'
				return '#f5a524'
			}

			//#region character
			/**
			 * The built-in mascot: a black Norwegian Forest cat with a white mask.
			 *
			 * The art is generated PNG, one drawing per state, served by the host at
			 * MASCOT_PATH — a client bundle cannot require a relative asset, so the
			 * file comes over a route. There is no vector fallback: two drawings of
			 * the same character drift apart, and a missing image is better reported
			 * than silently replaced by a different cat.
			 */
			var CHARACTER_STATES = ['idle', 'busy', 'happy', 'worried', 'sleepy', 'wave', 'pat', 'party']

			//#region dialogue
			/**
			 * What she says when clicked. Short, in character, and varied enough
			 * that a second click is not the same sentence again.
			 */
			var LINES = {
				idle: ['Off-peak right now. Half price, same model.', 'Nothing running. Good time to think.', 'Peak starts later — I will tell you.'],
				busy: ['Working on it. Do not close the tab.', 'Still going…', 'Thinking hard about your problem.'],
				happy: ['Done. That one cost you a little.', 'Finished. Want another?', 'Shipped it.'],
				worried: ['I cannot read your balance.', 'No API key that I can see.', 'The API is not answering me.'],
				sleepy: ['Zzz… still off-peak?', 'Nothing running. I dozed off.', 'Wake me when you have work.'],
				wave: ['Hey. Click me to see the rate.', 'Right-click me if you want the settings.'],
				pat: ['…okay, that is nice.', 'Do that again and I will charge you.', 'Pat accepted.'],
				party: ['Top-up! We are rich.', 'Balance went up. Spend it well.'],
			}
			/** How long a spoken line replaces the status line. */
			var LINE_MS = 5000
			var lineCursor = {}
			var lineLast = {}

			/**
			 * The next line for a state, cycling through its script and never
			 * repeating the previous one — a two-line script would otherwise say
			 * the same thing twice in a row whenever the cursor wrapped.
			 */
			function nextLine(state) {
				var script = LINES[state] === undefined ? LINES.idle : LINES[state]
				var index = (lineCursor[state] === undefined ? 0 : lineCursor[state]) % script.length
				var line = script[index]
				if (script.length > 1 && line === lineLast[state]) {
					index = (index + 1) % script.length
					line = script[index]
				}
				lineCursor[state] = (index + 1) % script.length
				lineLast[state] = line
				return line
			}
			//#endregion

			//#region sound
			/**
			 * Cues are synthesised with WebAudio rather than shipped as files: two
			 * tones cost no payload, no licence and no decode. Off unless the user
			 * turns it on, per the decision recorded in the character plan.
			 */
			var SOUND_KEY = 'dsh-status-widget:sound:v1'
			var soundState = null
			var audioContext = null

			function readSound() {
				if (soundState !== null) return soundState
				try {
					soundState = window.localStorage.getItem(SOUND_KEY) === '1'
				} catch {
					soundState = false
				}
				return soundState
			}

			var soundListeners = []

			function applySound(enabled, persist) {
				soundState = enabled === true
				if (persist !== false) {
					try {
						window.localStorage.setItem(SOUND_KEY, soundState ? '1' : '0')
					} catch {
						/* a blocked quota must not break the toggle */
					}
					savePrefs({ sound: soundState })
				}
				for (var i = 0; i < soundListeners.length; i++) soundListeners[i]()
			}

			function subscribeSound(listener) {
				soundListeners.push(listener)
				return function () {
					var index = soundListeners.indexOf(listener)
					if (index !== -1) soundListeners.splice(index, 1)
				}
			}

			/** One short cue. Silent when off, when unsupported, or when blocked. */
			function cue(kind) {
				if (kind === null || !readSound()) return
				// A pack's own audio wins over the synthesised cue, but only when the
				// author supplied one for this event.
				if (playPackSound(kind)) return
				try {
					var Ctor = window.AudioContext || window.webkitAudioContext
					if (Ctor === undefined) return
					if (audioContext === null) audioContext = new Ctor()
					var now = audioContext.currentTime
					var oscillator = audioContext.createOscillator()
					var gain = audioContext.createGain()
					var tones = kind === 'error' ? [196, 147] : kind === 'alert' ? [440, 659.25] : [523.25, 784]
					oscillator.type = kind === 'error' ? 'triangle' : 'sine'
					oscillator.frequency.setValueAtTime(tones[0], now)
					oscillator.frequency.exponentialRampToValueAtTime(tones[1], now + 0.12)
					gain.gain.setValueAtTime(0.0001, now)
					gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02)
					gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
					oscillator.connect(gain)
					gain.connect(audioContext.destination)
					oscillator.start(now)
					oscillator.stop(now + 0.24)
				} catch {
					/* audio is a nicety; never let it break the widget */
				}
			}
			//#endregion

			//#region prefs
			/**
			 * Preferences are stored host-side so the browser and the desktop client
			 * agree; localStorage stays as the offline fallback.
			 */
			function savePrefs(patch) {
				try {
					var query = Object.keys(patch)
						.map(function (key) {
							return key + '=' + encodeURIComponent(patch[key])
						})
						.join('&')
					fetch(PREFS_PATH + '?' + query, { method: 'PUT' }).catch(function () {
						/* the widget keeps working from its local copy */
					})
				} catch {
					/* a widget must not break because a preference did not save */
				}
			}

			/** Size shared by the widget and the settings panel. */
			var sizeState = null
			var sizeListeners = []

			function currentSize() {
				if (sizeState === null) sizeState = readSize()
				return sizeState
			}

			function publishSize() {
				for (var i = 0; i < sizeListeners.length; i++) sizeListeners[i]()
			}

			/** @param persist - false while applying what the host just sent. */
			function applySize(id, persist) {
				sizeState = resolveSize(id)
				if (persist !== false) {
					writeSize(sizeState.id)
					savePrefs({ size: sizeState.id })
				}
				publishSize()
			}

			function subscribeSize(listener) {
				sizeListeners.push(listener)
				return function () {
					var index = sizeListeners.indexOf(listener)
					if (index !== -1) sizeListeners.splice(index, 1)
				}
			}
			//#endregion

			//#region menu
			/**
			 * The right-click menu. Sizes are stored as the character's width in
			 * CSS pixels and converted to a height with the artwork's own ratio, so
			 * the four poses stay proportional at every size.
			 */
			// Height / width of the shipped artwork, which is a stance-aligned canvas.
			// 432x528: the built-in cat is wider than she is tall, and the canvas is
			// cropped to the tallest drawing so the bubble sits on her ears rather
			// than on a band of empty canvas.
			var ART_RATIO = 528 / 432
			var SIZES = [
				{ id: 'min', label: 'Min', width: 84 },
				{ id: 'small', label: 'Small', width: 120 },
				{ id: 'medium', label: 'Medium', width: 180 },
				{ id: 'max', label: 'Max', width: 260 },
			]
			var DEFAULT_SIZE = 'medium'
			var SIZE_KEY = 'dsh-status-widget:size:v1'

			/** The character's rendered box at a given size. */
			function characterBox(size, aspect) {
				return { width: size.width, height: Math.round(size.width * (aspect === undefined ? ART_RATIO : aspect)) }
			}

			/** The layout frame: fixed width, the character's height. */
			function frameBox(size, aspect) {
				return { width: FRAME_WIDTH, height: Math.round(size.width * (aspect === undefined ? ART_RATIO : aspect)) }
			}

			function resolveSize(id) {
				for (var i = 0; i < SIZES.length; i++) if (SIZES[i].id === id) return SIZES[i]
				return resolveSize(DEFAULT_SIZE)
			}

			function readSize() {
				try {
					return resolveSize(window.localStorage.getItem(SIZE_KEY))
				} catch {
					return resolveSize(DEFAULT_SIZE)
				}
			}

			function writeSize(id) {
				try {
					window.localStorage.setItem(SIZE_KEY, id)
				} catch {
					/* a blocked storage quota must not break the menu */
				}
			}
			//#endregion

			//#region placement
			/**
			 * Two placement modes.
			 *
			 * Docked: she is anchored to an edge and the bubble grows *around* her, so
			 * changing the text never slides her sideways. Free: she sits wherever she
			 * was dropped, and the bubble is centred above her.
			 *
			 * Docked stores side + bottom; free stores left + top. Both are clamped to
			 * the viewport on read, so a window resize repairs instead of stranding.
			 */
			var SNAP_ZONE = 48
			// Once docked, she must be dragged clearly away before she detaches —
			// otherwise the dock/undock boundary flickers under the cursor.
			var SNAP_HYSTERESIS = 24

			function clamp(value, min, max) {
				return Math.min(Math.max(value, min), Math.max(min, max))
			}

			/**
			 * Where a drag lands: docked if the pointer is inside a side snap zone,
			 * otherwise free at the pointer's position.
			 *
			 * @param input.pointerX - pointer position now.
			 * @param input.offsetX - pointer x relative to the widget's left edge.
			 * @param input.offsetY - pointer y relative to the widget's top edge.
			 * @param input.box - the character's rendered size.
			 * @param input.viewport - current viewport size.
			 */
			/**
			 * Free-placement bounds that keep the *drawing* inside the viewport.
			 *
			 * The frame is 220 wide but Max is 260, centred, so clamping the frame
			 * let her right edge pass the edge and the snap zone fire late.
			 */
			function freeBounds(viewport, element, inset) {
				return {
					minX: EDGE - inset,
					maxX: Math.max(EDGE - inset, viewport.width - element.width - EDGE - inset),
					minY: EDGE,
					maxY: Math.max(EDGE, viewport.height - element.height - EDGE),
				}
			}

			function dropTarget(input) {
				// Proximity is judged by where *she* would land, not where the
				// pointer is: grab her centre and the pointer sits ~90px inboard, so
				// a pointer-based zone never fires when she is visibly at the edge.
				var left = input.pointerX - input.offsetX
				var side =
					left <= SNAP_ZONE
						? 'left'
						: left + input.box.width >= input.viewport.width - SNAP_ZONE
							? 'right'
							: null
				if (side === null && input.dockedNow === true) {
					// Hysteresis: stay docked until she is clearly clear of the zone.
					if (input.dockedSide === 'left' && left <= SNAP_ZONE + SNAP_HYSTERESIS) side = 'left'
					else if (input.dockedSide === 'right' && left + input.box.width >= input.viewport.width - SNAP_ZONE - SNAP_HYSTERESIS) side = 'right'
				}
				if (side === null) {
					var bounds = freeBounds(input.viewport, input.box, input.inset === undefined ? 0 : input.inset)
					return {
						mode: 'free',
						x: clamp(input.pointerX - input.offsetX, bounds.minX, bounds.maxX),
						y: clamp(input.pointerY - input.offsetY, bounds.minY, bounds.maxY),
					}
				}
				// Docked: keep her feet under the pointer, clamped off the edges.
				var top = clamp(input.pointerY - input.offsetY, EDGE, input.viewport.height - input.box.height - EDGE)
				return {
					mode: 'docked',
					side: side,
					bottom: clamp(input.viewport.height - top - input.box.height, EDGE, input.viewport.height - input.box.height - EDGE),
				}
			}

			/** Stored placement, repaired against the current viewport. */
			function resolvePlacement(stored, viewport, element) {
				var valid = stored !== null && typeof stored === 'object'
				var width = element.width
				var height = element.height
				if (valid && stored.mode === 'free' && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
					var bounds = freeBounds(viewport, { width: width, height: height }, element.inset === undefined ? 0 : element.inset)
					return {
						mode: 'free',
						x: clamp(stored.x, bounds.minX, bounds.maxX),
						y: clamp(stored.y, bounds.minY, bounds.maxY),
					}
				}
				var side = valid && (stored.side === 'left' || stored.side === 'right') ? stored.side : 'right'
				var bottom = 24
				if (valid && Number.isFinite(stored.bottom)) bottom = stored.bottom
				else if (valid && Number.isFinite(stored.top)) bottom = viewport.height - stored.top - height
				return { mode: 'docked', side: side, bottom: clamp(bottom, EDGE, viewport.height - height - EDGE) }
			}

			function readPlacement() {
				try {
					return JSON.parse(window.localStorage.getItem(PLACEMENT_KEY))
				} catch {
					return null
				}
			}

			function writePlacement(placement) {
				try {
					window.localStorage.setItem(PLACEMENT_KEY, JSON.stringify(placement))
				} catch {
					/* a blocked storage quota must not break dragging */
				}
			}

			function viewportSize() {
				return { width: window.innerWidth || 1024, height: window.innerHeight || 768 }
			}
			//#endregion

			function readCollapsed() {
				try {
					return window.localStorage.getItem(COLLAPSE_KEY) === '1'
				} catch {
					return false
				}
			}

			function writeCollapsed(value) {
				try {
					window.localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0')
				} catch {
					/* a blocked storage quota is not worth a broken toggle */
				}
			}

			/** Character and card styles, injected once at materialization. */
			function ensureStyles() {
				if (typeof document === 'undefined') return
				if (document.getElementById('dsh-status-widget-styles') !== null) return
				var style = document.createElement('style')
				style.id = 'dsh-status-widget-styles'
				style.textContent =
					'@keyframes dshsw-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}' +
					// Only the built-in still drawing: a pack's sprite sheet carries its own
					// animation, and a stylesheet rule on the same class would fight it.
					'.dshsw-still{animation:dshsw-bob 3.6s ease-in-out infinite;transform-origin:50% 90%}' +

					'@keyframes dshsw-hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-7px)}}' +
				'.dshsw-still[data-state="busy"]{animation-duration:1.1s}' +
				'.dshsw-still[data-state="happy"]{animation:dshsw-hop .55s ease-in-out 3}' +
				'@media (prefers-reduced-motion: reduce){.dshsw-still{animation:none}}'
				document.head.appendChild(style)
			}

			//#region packs
			/**
			 * The active pack, if one is installed: `{ baseUrl, manifest }`.
			 *
			 * Null means the built-in character. The import surface sets this after
			 * reading `character.json`; until then every lookup here answers null and
			 * the built-in art renders exactly as before.
			 */
			var activePack = null

			/** Pack sounds by event, so a cue can prefer the author's audio. */
			var packSounds = {}

			/** Installed packs, as the host last reported them. */
			var packsState = { ready: false, active: null, packs: [] }
			var packListeners = []

			function readPacks() {
				return packsState
			}

			function subscribePacks(listener) {
				packListeners.push(listener)
				return function () {
					var index = packListeners.indexOf(listener)
					if (index !== -1) packListeners.splice(index, 1)
				}
			}

			/**
			 * Ask the host what is installed and adopt the active pack.
			 *
			 * One function for the first load and for every switch, so the art, the
			 * sounds and the menu cannot disagree about which pack is on.
			 */
			function refreshPacks() {
				return fetch(PACK_BASE + '/characters', { cache: 'no-store' })
					.then(function (response) {
						return response.json()
					})
					.then(function (payload) {
						if (payload === null || payload.ok !== true) return
						var packs = payload.packs || []
						packsState = { ready: true, active: payload.active, packs: packs }
						for (var i = 0; i < packListeners.length; i++) packListeners[i]()
						if (payload.active === null) {
							setActivePack(null)
							packSounds = {}
							return
						}
						var pack = packs.filter(function (entry) {
							return entry.id === payload.active
						})[0]
						if (pack === undefined || pack.manifest === undefined) return
						setActivePack({ manifest: pack.manifest })
						packSounds = {}
						var sounds = pack.manifest.sounds || {}
						for (var event in sounds) {
							if (Object.prototype.hasOwnProperty.call(sounds, event)) {
								packSounds[event] = PACK_BASE + '/character/sound?event=' + encodeURIComponent(event)
							}
						}
					})
					.catch(function () {
						/* the host may not serve packs yet; the built-in art stands */
					})
			}

			/**
			 * Import a `.dshchar` file and switch to it.
			 *
			 * Import-then-activate is one gesture on purpose: importing a character
			 * and seeing nothing change is the kind of "did it work?" moment this
			 * widget should not create.
			 */
			function importPackFile(file) {
				return new Promise(function (resolve) {
					var reader = new FileReader()
					reader.onload = function () {
						var parsed
						try {
							parsed = JSON.parse(String(reader.result))
						} catch {
							resolve({ ok: false, errors: ['not-json'] })
							return
						}
						fetch(PACK_BASE + '/characters', {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: JSON.stringify(parsed),
						})
							.then(function (response) {
								return response.json()
							})
							.then(function (payload) {
								if (payload === null || payload.ok !== true) {
									resolve({ ok: false, errors: (payload && payload.errors) || ['refused'] })
									return
								}
								choosePack(payload.id).then(function () {
									resolve({ ok: true, id: payload.id })
								})
							})
							.catch(function () {
								resolve({ ok: false, errors: ['host-unreachable'] })
							})
					}
					reader.onerror = function () {
						resolve({ ok: false, errors: ['read-failed'] })
					}
					reader.readAsText(file)
				})
			}

			/** Open the system picker without rendering a visible input. */
			function pickPackFile(onResult) {
				if (typeof document === 'undefined') return
				var input = document.createElement('input')
				input.type = 'file'
				input.accept = '.dshchar,application/json'
				input.style.display = 'none'
				var cleaned = false
				function clean() {
					if (cleaned) return
					cleaned = true
					if (input.parentNode !== null && input.parentNode !== undefined) input.parentNode.removeChild(input)
				}
				input.addEventListener('cancel', clean)
				input.addEventListener('change', function () {
					var file = input.files !== null && input.files !== undefined ? input.files[0] : undefined
					if (file === undefined) {
						clean()
						return
					}
					importPackFile(file).then(function (result) {
						clean()
						onResult(result)
					})
				})
				document.body.appendChild(input)
				input.click()
			}

			/** Switch to a pack id, or to the built-in character when id is null. */
			function choosePack(id) {
				var request =
					id === null
						? fetch(PACK_BASE + '/characters/active', { method: 'DELETE' })
						: fetch(PACK_BASE + '/characters/' + encodeURIComponent(id) + '/active', { method: 'POST' })
				return request
					.then(function () {
						return refreshPacks()
					})
					.catch(function () {})
			}

			function setActivePack(pack) {
				activePack = pack === undefined ? null : pack
			}

			function activePackState() {
				return activePack
			}

			/** The sheet descriptor for a state, or null. */
			function sheetFor(state) {
				if (activePack === null || activePack.manifest === null || typeof activePack.manifest !== 'object') return null
				var sheets = activePack.manifest.sheets
				if (sheets === null || typeof sheets !== 'object') return null
				var sheet = sheets[state]
				if (sheet === null || typeof sheet !== 'object') return null
				// The manifest carries a pack-relative path; the browser needs a route.
				return Object.assign({}, sheet, { url: PACK_BASE + '/character/sheet.png?state=' + state })
			}

			/**
			 * Columns and rows of a sheet. Mirrors `sheetGrid` in src/pack.js; the
			 * validator owns the rules and the renderer must not invent its own.
			 */
			function sheetGrid(sheet) {
				var frames = typeof sheet.frames === 'number' && isFinite(sheet.frames) ? Math.max(1, Math.round(sheet.frames)) : 1
				if (sheet.layout === 'vertical') return { cols: 1, rows: frames }
				if (sheet.layout === 'grid') {
					var wanted = typeof sheet.columns === 'number' && isFinite(sheet.columns) ? Math.max(1, Math.round(sheet.columns)) : 1
					var cols = Math.min(wanted, frames)
					return { cols: cols, rows: Math.ceil(frames / cols) }
				}
				return { cols: frames, rows: 1 }
			}

			/**
			 * Keyframes that step a sheet, in any layout.
			 *
			 * A horizontal strip can be walked with `steps()` on one axis, but a
			 * grid needs both axes per frame, so the positions are written out.
			 * A 60-frame sheet is a 60-entry rule — cheaper than it sounds, and
			 * only generated for sheets a pack actually declares.
			 */
			function spriteKeyframes(name, sheet) {
				var frames = typeof sheet.frames === 'number' && isFinite(sheet.frames) ? Math.max(1, Math.round(sheet.frames)) : 1
				var grid = sheetGrid(sheet)
				var steps = []
				for (var i = 0; i < frames; i++) {
					var col = i % grid.cols
					var row = Math.floor(i / grid.cols)
					var x = grid.cols === 1 ? 0 : (col / (grid.cols - 1)) * 100
					var y = grid.rows === 1 ? 0 : (row / (grid.rows - 1)) * 100
					steps.push(Math.round((i / frames) * 10000) / 100 + '%{background-position:' + round2(x) + '% ' + round2(y) + '%}')
				}
				return '@keyframes ' + name + '{' + steps.join('') + '}'
			}

			function round2(value) {
				return Math.round(value * 100) / 100
			}

			/** A stable keyframe name for a sheet, so two sheets cannot collide. */
			function spriteAnimationName(sheet) {
				var grid = sheetGrid(sheet)
				var fps = String(sheet.fps === undefined ? 8 : sheet.fps).replace('.', '_')
				return 'dshsw-sheet-' + grid.cols + 'x' + grid.rows + '-' + (sheet.frames || 1) + 'f-' + fps
			}

			/** Register a sheet's keyframes once, then return the name. */
			function ensureSheetKeyframes(sheet) {
				var name = spriteAnimationName(sheet)
				if (typeof document === 'undefined') return name
				if (document.getElementById(name) !== null) return name
				var style = document.createElement('style')
				style.id = name
				style.textContent = spriteKeyframes(name, sheet)
				document.head.appendChild(style)
				return name
			}

			/**
			 * A sprite sheet as a style object.
			 *
			 * The element is one frame; the background is the whole sheet, sized in
			 * frame units; the animation walks the sheet with `step-end` so each
			 * frame holds instead of blending. Layout (horizontal, vertical, grid)
			 * only changes the grid maths.
			 */
			function spriteStyle(sheet, scale) {
				if (sheet === null || typeof sheet !== 'object') return null
				var frames = typeof sheet.frames === 'number' && isFinite(sheet.frames) ? Math.max(1, Math.round(sheet.frames)) : 1
				var fps = typeof sheet.fps === 'number' && isFinite(sheet.fps) && sheet.fps > 0 ? sheet.fps : 8
				var factor = typeof scale === 'number' && isFinite(scale) && scale > 0 ? scale : 1
				var frameWidth = typeof sheet.frameWidth === 'number' && isFinite(sheet.frameWidth) ? sheet.frameWidth : 0
				var frameHeight = typeof sheet.frameHeight === 'number' && isFinite(sheet.frameHeight) ? sheet.frameHeight : 0
				var grid = sheetGrid(sheet)
				var name = ensureSheetKeyframes(sheet)
				return {
					width: Math.round(frameWidth * factor) + 'px',
					height: Math.round(frameHeight * factor) + 'px',
					backgroundImage: 'url(' + sheet.url + ')',
					backgroundSize: grid.cols * 100 + '% ' + grid.rows * 100 + '%',
					backgroundRepeat: 'no-repeat',
					animation: name + ' ' + frames / fps + 's step-end infinite',
				}
			}

			/** Try a pack's audio for an event; returns whether one was played. */
			function playPackSound(event) {
				var url = packSounds[event]
				if (typeof url !== 'string') return false
				try {
					var audio = new window.Audio(url)
					var played = audio.play()
					if (played !== undefined && typeof played.catch === 'function') played.catch(function () {})
					return true
				} catch {
					return false
				}
			}
			//#endregion

			//#region language
			/**
			 * Localisation for the text this widget *authors*: dialogue, idle acts and
			 * the menu. The rate labels produced by `describe()` stay English for now
			 * — they are pinned by the schedule tests, and wrapping them is a separate
			 * pass with its own risk.
			 *
			 * `auto` follows the browser, which in this ecosystem is often zh.
			 */
			var LANG_KEY = 'dsh-status-widget:lang:v1'
			var langState = null

			var TEXT = {
				en: {
					'pat.0': '*happy whirring*',
					'pat.1': 'Yes, the airframe is real.',
					'pat.2': 'Careful, that is the canopy.',
					'pat.3': 'Purring. Do not tell anyone.',
					'act.0': '*stretches*',
					'act.1': '*adjusts her headphones*',
					'act.2': '*checks the wing mirrors*',
					'act.3': '*hums something in a minor key*',
					'act.4': '*taps the fuselage*',
					'act.5': '*stares into the middle distance*',
					'peak.start': 'Peak rates just started. Full price.',
					'peak.end': 'Off-peak now — half price until the next peak.',
					'low': 'Balance is low: {value}',
					'menu.size': 'Size',
					'menu.character': 'Character',
					'menu.builtin': 'Built-in',
					'menu.import': 'Import',
					'menu.reset': 'Reset position',
					'menu.settings': 'Settings',
					'menu.sound': 'Sound',
					'menu.roam': 'Roaming',
					'menu.model': 'Pricing',
					'menu.low': 'Low balance',
					'menu.off': 'Off',
					'settings.model': 'Pricing model',
					'settings.low': 'Low-balance warning',
					'settings.roam': 'Roaming',
					'settings.sound': 'Sound',
					'waiting': 'Waiting for your approval',
				},
				zh: {
					'pat.0': '（开心地嗡鸣）',
					'pat.1': '对，机身是真的。',
					'pat.2': '小心，那是座舱盖。',
					'pat.3': '喵呜。别说出去。',
					'act.0': '（伸了个懒腰）',
					'act.1': '（调了调耳机）',
					'act.2': '（看了看后视镜）',
					'act.3': '（哼了一段小调）',
					'act.4': '（敲了敲机身）',
					'act.5': '（望向远处）',
					'peak.start': '高峰时段开始了，全价计费。',
					'peak.end': '现在是谷时——半价，直到下个高峰。',
					'low': '余额偏低：{value}',
					'menu.size': '尺寸',
					'menu.character': '角色',
					'menu.builtin': '内置',
					'menu.import': '导入',
					'menu.reset': '重置位置',
					'menu.settings': '设置',
					'menu.sound': '音效',
					'menu.roam': '自动漫游',
					'menu.model': '计价',
					'menu.low': '余额提醒',
					'menu.off': '关闭',
					'settings.model': '计价模型',
					'settings.low': '余额提醒',
					'settings.roam': '自动漫游',
					'settings.sound': '音效',
					'waiting': '等待你的授权',
				},
			}

			function readLang() {
				if (langState !== null) return langState
				try {
					var stored = window.localStorage.getItem(LANG_KEY)
					if (stored === 'en' || stored === 'zh') langState = stored
					else langState = typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '') ? 'zh' : 'en'
				} catch {
					langState = 'en'
				}
				return langState
			}

			function applyLang(lang, persist) {
				langState = lang === 'zh' ? 'zh' : 'en'
				if (persist !== false) {
					try {
						window.localStorage.setItem(LANG_KEY, langState)
					} catch {
						/* ignore */
					}
					savePrefs({ lang: langState })
				}
							publishLang()
			}

			/** Look up a key in the active language, falling back to English, then to the key. */
			function t(key, vars) {
				var table = TEXT[readLang()] || TEXT.en
				var value = table[key]
				if (value === undefined) value = TEXT.en[key]
				if (value === undefined) return key
				if (vars !== undefined) {
					for (var name in vars) {
						if (Object.prototype.hasOwnProperty.call(vars, name)) value = value.replace('{' + name + '}', vars[name])
					}
				}
				return value
			}
			//#endregion

			//#region watching
			/**
			 * Boundary and threshold watchers.
			 *
			 * These are edge detectors, not features of the render: they fire once
			 * when a fact changes, so a 1 s clock cannot turn them into a stream of
			 * repeated announcements.
			 */
			var watched = { peak: null, lowUntil: 0 }

			/**
			 * Speak when the rate class flips. The plugin's whole subject is the
			 * peak boundary, and until now it computed the boundary and never said it.
			 *
			 * @returns a line to speak, or null when nothing changed.
			 */
			function peakChangeLine(nowMs) {
				var peak = isPeak(nowMs)
				if (watched.peak === null) {
					watched.peak = peak
					return null
				}
				if (watched.peak === peak) return null
				watched.peak = peak
				return t(peak ? 'peak.start' : 'peak.end')
			}

			/**
			 * Whether the account is below the warning line.
			 *
			 * Threshold 0 disables it. Only the lowest currency is compared, because
			 * mixing a CNY and a USD balance into one "low" judgement would be wrong.
			 */
			function lowBalanceLine(payload, threshold) {
				if (threshold <= 0 || payload === null || payload.ok !== true) return null
				var lowest = null
				for (var i = 0; i < payload.balances.length; i++) {
					var value = Number(payload.balances[i].total)
					if (!isFinite(value)) continue
					if (lowest === null || value < lowest.value) lowest = { value: value, currency: payload.balances[i].currency, text: payload.balances[i].total }
				}
				if (lowest === null || lowest.value >= threshold) return null
				return t('low', { value: CURRENCY_SYMBOL[lowest.currency] + lowest.text })
			}

			/** Idle acts: something to watch while nothing is happening. */
			var IDLE_ACTS = [
				'*stretches*',
				'*adjusts her headphones*',
				'*checks the wing mirrors*',
				'*hums something in a minor key*',
				'*taps the fuselage*',
				'*stares into the middle distance*',
			]
			var idleActAt = 0
			var idleActIndex = 0

			/** One act every ~90 s of quiet, cycling rather than repeating at random. */
			function idleAct(nowMs, quiet) {
				if (!quiet) {
					idleActAt = nowMs
					return null
				}
				if (idleActAt === 0) idleActAt = nowMs
				if (nowMs - idleActAt < 90000) return null
				idleActAt = nowMs
				idleActIndex = (idleActIndex + 1) % IDLE_ACTS.length
				return t('act.' + idleActIndex)
			}
			//#endregion

			//#region context pressure
			/**
			 * How full the context window is, from the `contextPressure` projection:
			 * `pressureTokens` (the last request's prompt) and `contextWindow` (the
			 * newest advertised capacity). Both are absent until a provider reports
			 * usage, which is why every consumer here answers null rather than zero.
			 *
			 * `projectedTokens` is what the *next* request would carry; it is the
			 * more useful number while a turn is running, so prefer it when present.
			 */
			function readPressure(sessions, sessionId) {
				try {
					var binding = sessions === undefined || sessionId === undefined || sessionId === null ? undefined : sessions.binding(sessionId)
					var face = binding === undefined ? undefined : binding.session.projections.faceOf('contextPressure')
					var value = face === undefined ? undefined : face.getSnapshot()
					if (value === undefined || value === null) return null
					var used = typeof value.projectedTokens === 'number' ? value.projectedTokens : value.pressureTokens
					if (typeof used !== 'number' || !isFinite(used)) return null
					var window = typeof value.contextWindow === 'number' && value.contextWindow > 0 ? value.contextWindow : null
					return { used: used, window: window, ratio: window === null ? null : Math.min(1, used / window) }
				} catch {
					return null
				}
			}

			/** Services captured at apply time, for the reads the component does per tick. */
			var runtime = { sessions: undefined }

			/** A thin bar under the bubble when capacity is known. */
			function pressureBarStyle(pressure) {
				var ratio = pressure.ratio === null ? 0 : pressure.ratio
				return {
					height: '3px',
					borderRadius: '2px',
					marginTop: '4px',
					background: 'rgba(127,127,127,0.22)',
					overflow: 'hidden',
					position: 'relative',
					width: '100%',
					display: ratio === 0 ? 'none' : 'block',
				}
			}

			var pressureFillStyle = {
				height: '100%',
				borderRadius: '2px',
				transition: 'width 0.3s ease',
			}
			//#endregion

			//#region cost
			/**
			 * USD per million tokens, at *peak*. Off-peak is exactly half, and the
			 * tests hold that relationship rather than hard-coding both columns.
			 *
			 * Cache writes are billed as ordinary input: DeepSeek publishes a cache
			 * read discount but no separate write premium.
			 */
			var RATES = {
				flash: { cacheRead: 0.006, input: 0.3, output: 1.2 },
				pro: { cacheRead: 0.044, input: 1.32, output: 3.96 },
			}
			var MODELS = ['flash', 'pro']
			var MODEL_KEY = 'dsh-status-widget:model:v1'
			var LOW_KEY = 'dsh-status-widget:low:v1'
			var ROAM_KEY = 'dsh-status-widget:roam:v1'
			var lowState = null
			var roamState = null

			/** Balance below which she warns, in the account's currency. 0 disables. */
			function readLow() {
				// `getItem` returns null when unset, and Number(null) is 0 — which
				// silently disabled the low-balance warning on a fresh profile.
				if (lowState !== null) return lowState
				try {
					var raw = window.localStorage.getItem(LOW_KEY)
					var stored = raw === null ? NaN : Number(raw)
					lowState = isFinite(stored) && stored >= 0 ? stored : 5
				} catch {
					lowState = 5
				}
				return lowState
			}

			function applyLow(value, persist) {
				lowState = isFinite(value) && value >= 0 ? value : 0
				if (persist !== false) {
					try {
						window.localStorage.setItem(LOW_KEY, String(lowState))
					} catch {
						/* ignore */
					}
					savePrefs({ low: lowState })
				}
							publishLow()
			}

			/** Whether she drifts along a docked edge when left alone. */
			function readRoam() {
				if (roamState !== null) return roamState
				try {
					roamState = window.localStorage.getItem(ROAM_KEY) !== '0'
				} catch {
					roamState = true
				}
				return roamState
			}

			function applyRoam(on, persist) {
				roamState = on === true
				if (persist !== false) {
					try {
						window.localStorage.setItem(ROAM_KEY, roamState ? '1' : '0')
					} catch {
						/* ignore */
					}
					savePrefs({ roam: roamState })
				}
							publishRoam()
			}
			var modelState = null

			function readModel() {
				if (modelState !== null) return modelState
				try {
					var stored = window.localStorage.getItem(MODEL_KEY)
					modelState = MODELS.indexOf(stored) === -1 ? 'flash' : stored
				} catch {
					modelState = 'flash'
				}
				return modelState
			}

			/**
			 * Listeners for the preferences that had none.
			 *
			 * Model, low-balance, roaming and language changed the module state without
			 * telling anyone, so a value applied from the host's preferences or from
			 * another tab left the menu and the panel showing the old value.
			 */
			var preferenceListeners = { model: [], low: [], roam: [], lang: [] }

			function publishPreference(key) {
				var list = preferenceListeners[key]
				for (var i = 0; i < list.length; i++) list[i]()
			}

			function subscribePreference(key, listener) {
				preferenceListeners[key].push(listener)
				return function () {
					var index = preferenceListeners[key].indexOf(listener)
					if (index !== -1) preferenceListeners[key].splice(index, 1)
				}
			}

			function publishModel() {
				publishPreference('model')
			}
			function publishLow() {
				publishPreference('low')
			}
			function publishRoam() {
				publishPreference('roam')
			}
			function publishLang() {
				publishPreference('lang')
			}

			function applyModel(model, persist) {
				modelState = MODELS.indexOf(model) === -1 ? 'flash' : model
				if (persist !== false) {
					try {
						window.localStorage.setItem(MODEL_KEY, modelState)
					} catch {
						/* a blocked quota must not break the setting */
					}
					savePrefs({ model: modelState })
				}
							publishModel()
			}

			/**
			 * Cost of a usage delta, in USD.
			 *
			 * @param usage - the four bucket counts.
			 * @param peak - true at peak rates, false off-peak.
			 * @param model - 'flash' or 'pro'.
			 * @returns the cost, or null when the usage is not readable.
			 */
			function costOf(usage, peak, model) {
				if (usage === null || typeof usage !== 'object') return null
				var rate = RATES[MODELS.indexOf(model) === -1 ? 'flash' : model]
				var buckets = [
					['cacheReadTokens', rate.cacheRead],
					['cacheWriteTokens', rate.input],
					['uncachedInputTokens', rate.input],
					['outputTokens', rate.output],
				]
				var total = 0
				for (var i = 0; i < buckets.length; i++) {
					var count = usage[buckets[i][0]]
					if (typeof count !== 'number' || !isFinite(count) || count < 0) return null
					total += count * buckets[i][1]
				}
				return (total / 1e6) * (peak ? 1 : 0.5)
			}

			/** Bucket-wise difference of two cumulative readings, clamped at zero. */
			var USAGE_BUCKETS = ['cacheReadTokens', 'cacheWriteTokens', 'uncachedInputTokens', 'outputTokens']

			function usageDelta(before, after) {
				if (before === null || after === null) return null
				if (typeof before !== 'object' || typeof after !== 'object') return null
				var out = {}
				// Only the four known buckets: a projection may carry other numbers,
				// and copying them would bill something that is not a token.
				for (var i = 0; i < USAGE_BUCKETS.length; i++) {
					var key = USAGE_BUCKETS[i]
					var value = after[key]
					if (typeof value !== 'number' || !isFinite(value)) continue
					var prior = typeof before[key] === 'number' && isFinite(before[key]) ? before[key] : 0
					// A compaction can reset the fold; never report a negative spend.
					out[key] = Math.max(0, value - prior)
				}
				return out
			}

			/** Cumulative usage for a session, or null when the projection is absent. */
			function readUsage(sessions, sessionId) {
				try {
					var binding = sessions === undefined || sessionId === null ? undefined : sessions.binding(sessionId)
					var face = binding === undefined ? undefined : binding.session.projections.faceOf('tokenUsage')
					var value = face === undefined ? undefined : face.getSnapshot()
					return value === undefined ? null : value
				} catch {
					return null
				}
			}

			/** "Last turn $0.0042" for a short while after a turn ends. */
			var turnCost = null
			var turnCostListeners = []

			function publishTurnCost(cost, tokens) {
				turnCost = cost === null ? null : { usd: cost, tokens: tokens, at: Date.now() }
				for (var i = 0; i < turnCostListeners.length; i++) turnCostListeners[i]()
			}

			function readTurnCost() {
				return turnCost
			}

			function subscribeTurnCost(listener) {
				turnCostListeners.push(listener)
				return function () {
					var index = turnCostListeners.indexOf(listener)
					if (index !== -1) turnCostListeners.splice(index, 1)
				}
			}

			function formatUsd(value) {
				if (value === 0) return '$0.0000'
				return '$' + (value < 0.01 ? value.toFixed(4) : value.toFixed(3))
			}
			//#endregion

			//#region approvals
			/**
			 * Whether the agent is blocked waiting on the user.
			 *
			 * Source: `uiSession.sessionStatus`, a push-based store whose
			 * `pendingInteraction` is populated by the same domain machinery that
			 * approval prompts publish into. Not the `permissions` projection — that
			 * one is the permission *preset*, a trap worth naming.
			 */
			var approval = { waiting: false, sessionId: null }
			var approvalListeners = []

			function readApproval() {
				return approval
			}

			/** Returns true when this call changed the state, for one-shot cues. */
			function setWaiting(waiting, sessionId) {
				var changed = approval.waiting !== waiting || approval.sessionId !== sessionId
				approval = { waiting: waiting, sessionId: sessionId }
				if (!changed) return false
				for (var i = 0; i < approvalListeners.length; i++) approvalListeners[i]()
				return true
			}

			function subscribeApproval(listener) {
				approvalListeners.push(listener)
				return function () {
					var index = approvalListeners.indexOf(listener)
					if (index !== -1) approvalListeners.splice(index, 1)
				}
			}

			/** The session the UI is showing, or null. Mirrors uiSession's own predicate. */
			function mainSessionId(sessions) {
				try {
					var list = sessions.list.getSnapshot()
					for (var i = 0; i < list.ids.length; i++) {
						var row = list.byId[list.ids[i]]
						if (row !== undefined && row.retainedBy !== undefined && row.retainedBy.mainView > 0) return list.ids[i]
					}
				} catch {
					/* an unavailable catalog is "no main session", not a crash */
				}
				return null
			}

			/**
			 * Read the whole status map and publish the waiting fact.
			 *
			 * Prefers the session on screen; falls back to any session that is
			 * waiting, because a blocked turn in a background session still needs
			 * the user.
			 */
			function readPendingFrom(uiSession, sessions) {
				var snapshot
				try {
					snapshot = uiSession.sessionStatus.getSnapshot()
				} catch {
					return
				}
				if (!(snapshot instanceof Map)) return
				var main = sessions === undefined ? null : mainSessionId(sessions)
				var waitingId = null
				if (main !== null) {
					var row = snapshot.get(main)
					if (row !== undefined && row.pendingInteraction !== undefined) waitingId = main
				}
				if (waitingId === null) {
					snapshot.forEach(function (value, id) {
						if (waitingId === null && value !== undefined && value.pendingInteraction !== undefined) waitingId = id
					})
				}
				if (setWaiting(waitingId !== null, waitingId)) cue(waitingId !== null ? 'alert' : null)
			}
			//#endregion

			//#region activity
			/**
			 * Whether a turn is running, and a short celebration window after one
			 * ends. Module scope with a subscriber list: the fact arrives from an
			 * event, not from a prop.
			 */
			var activity = { busy: false, happyUntil: 0, patUntil: 0, partyUntil: 0, waveUntil: 0, lastSeen: 0 }
			var activityListeners = []

			function publishActivity() {
				for (var i = 0; i < activityListeners.length; i++) activityListeners[i]()
			}

			function setBusy(running) {
				var was = activity.busy
				activity.busy = running
				activity.lastSeen = Date.now()
				if (was === true && running === false) {
					activity.happyUntil = Date.now() + 2500
					cue('done')
				}
				if (was !== running) publishActivity()
			}

			/** A pat is worth its own face, briefly. */
			function patLanded(nowMs) {
				var at = nowMs === undefined ? Date.now() : nowMs
				activity.patUntil = at + 2200
				activity.lastSeen = at
				publishActivity()
			}

			/** A top-up is good news; celebrate it once. */
			function balanceRose(nowMs) {
				var at = nowMs === undefined ? Date.now() : nowMs
				activity.partyUntil = at + 6000
				publishActivity()
			}

			/** Greet once, when the widget first appears. */
			function greet(nowMs) {
				var at = nowMs === undefined ? Date.now() : nowMs
				activity.waveUntil = at + 3500
				activity.lastSeen = at
				publishActivity()
			}

			/** A plain copy of the activity record, for React state. */
			function activitySnapshot() {
				return {
					busy: activity.busy,
					happyUntil: activity.happyUntil,
					patUntil: activity.patUntil,
					partyUntil: activity.partyUntil,
					waveUntil: activity.waveUntil,
					lastSeen: activity.lastSeen,
				}
			}

			function subscribeActivity(listener) {
				activityListeners.push(listener)
				return function () {
					var index = activityListeners.indexOf(listener)
					if (index !== -1) activityListeners.splice(index, 1)
				}
			}

			/**
			 * Which face to draw, in precedence order.
			 *
			 * Busy outranks everything because it is the only state with a deadline.
			 * The interaction windows (pat, party, wave, happy) are brief and expire
			 * on their own; sleepiness is the only state that grows with time, and it
			 * only applies when nothing else is happening.
			 */
			function resolveFace(status, payload, snapshot, now) {
				// Approval waiting is folded in by the caller, which owns that store.
				if (snapshot.busy) return 'busy'
				if (now < snapshot.patUntil) return 'pat'
				if (now < snapshot.partyUntil) return 'party'
				if (now < snapshot.waveUntil) return 'wave'
				if (now < snapshot.happyUntil) return 'happy'
				// No sighting recorded means she has not been idle; treat as awake.
				var quiet = snapshot.lastSeen ? now - snapshot.lastSeen : 0
				if (payload !== null && payload.ok === false) return 'worried'
				if (quiet > SLEEP_AFTER_MS) return 'sleepy'
				return characterState(status, payload)
			}

			/** The last balance payload seen, so a comparison across polls works. */
			var lastBalance = null

			/** Totals by currency: comparing CNY against USD would fake a top-up. */
			function totalsOf(payload) {
				if (payload === null || payload.ok !== true || !Array.isArray(payload.balances)) return null
				var out = {}
				for (var i = 0; i < payload.balances.length; i++) {
					var value = Number(payload.balances[i].total)
					if (isFinite(value)) out[payload.balances[i].currency] = value
				}
				return out
			}

			/** Whether any currency's balance rose since the previous read. */
			function balanceIncreased(before, after) {
				if (before === null || after === null) return false
				for (var currency in after) {
					if (!Object.prototype.hasOwnProperty.call(after, currency)) continue
					if (before[currency] !== undefined && after[currency] > before[currency] + 0.01) return true
				}
				return false
			}

			/** Ten minutes with nothing running is long enough to doze. */
			var SLEEP_AFTER_MS = 10 * 60 * 1000
			//#endregion

			function patLine(index) {
				return t('pat.' + (index % 4))
			}
			var patCount = 0
			var roamDirection = 1

			/** In-flight drag. Module scope, not React state: it must survive renders. */
			var drag = null

			/**
			 * The right-click menu, as a pure function of its state.
			 *
			 * Extracted from the component because this is the most-edited block in
			 * the plugin and it shipped broken twice with no test able to see it: a
			 * duplicate declaration shadowed the submenu, then the submenu rendered
			 * flat. A test can walk this tree; it could not walk the component.
			 *
			 * @param view.at - cursor position.
			 * @param view.open - whether the Size submenu is expanded.
			 * @param view.leftward - open the submenu to the left.
			 * @param view.current - selected size id.
			 * @param view.onChoose - receives a size id.
			 * @param view.onToggle - opens or closes the submenu.
			 * @param view.onReset - restores the default placement and size.
			 */
			/**
			 * Which nested submenu is open, given a request to open one.
			 *
			 * Only one can be open: they occupy the same position beside the panel,
			 * and two panels stacked means the last one painted wins and the other
			 * looks broken.
			 *
			 * @param current - `{ sizeOpen, characterOpen }` as it stands.
			 * @param want - `'size'`, `'character'`, or null to close both.
			 */
			function nextSubmenu(current, want) {
				if (want === 'size') return { sizeOpen: current.sizeOpen !== true, characterOpen: false }
				if (want === 'character') return { sizeOpen: false, characterOpen: current.characterOpen !== true }
				return { sizeOpen: false, characterOpen: false }
			}

			/**
			 * Whether a press landed on her head.
			 *
			 * The root box holds the bubble *and* the character, so "top third of
			 * the widget" was the bubble: a pat on her head counted as a click on
			 * the text, and patting appeared to do nothing. The zone is measured
			 * against the drawing instead.
			 *
			 * @param offsetY - press position from the root's top edge.
			 * @param rootHeight - the whole widget's height.
			 * @param characterHeight - the drawing's height.
			 */
			function isPatZone(offsetY, rootHeight, characterHeight) {
			if (!(characterHeight > 0) || !(rootHeight > 0)) return false
			var top = Math.max(0, rootHeight - characterHeight)
			return offsetY >= top && offsetY <= top + characterHeight * 0.35
			}

			function renderMenu(view) {
				/** The current size's label, so the row answers "which one is it" without a hover. */
				/** The active pack's name, or "Built-in". */
				function currentPackLabel() {
					if (view.packActive === null) return t('menu.builtin')
					for (var i = 0; i < view.packs.length; i++) if (view.packs[i].id === view.packActive) return view.packs[i].name
					return t('menu.builtin')
				}

				function sizeLabel() {
					for (var i = 0; i < SIZES.length; i++) if (SIZES[i].id === view.current) return SIZES[i].label
					return ''
				}

				function item(label, options) {
					return React.createElement(
						'button',
						Object.assign({ type: 'button', style: menuItemStyle }, options),
						label,
					)
				}

				var sizePanel =
					view.sizeOpen === true
						? React.createElement(
								'div',
								{
									// Sibling of the scroller, positioned against the panel: a
									// scroll container would make it scrollable content and
									// clip it instead of letting it overlay.
									style: Object.assign(
										{},
										submenuStyle,
										{ zIndex: 82, top: '0px' },
										view.leftward ? { right: '100%', marginRight: '4px' } : { left: '100%', marginLeft: '4px' },
									),
									role: 'menu',
									onPointerDown: function (event) {
										event.stopPropagation()
									},
								},
								SIZES.map(function (option, index) {
									var checked = view.current === option.id
									return React.createElement(
										'button',
										{
											key: option.id,
											type: 'button',
											role: 'menuitemradio',
											'aria-checked': checked ? 'true' : 'false',
											onClick: function () {
												view.onChoose(option.id)
											},
											style: Object.assign(
												{},
												menuItemStyle,
												checked ? menuItemActiveStyle : null,
												view.focusIndex === index ? menuItemFocusStyle : null,
											),
										},
										(checked ? '\u25CF ' : '   ') + option.label,
									)
								}),
							)
						: null

				var characterPanel =
					view.characterOpen === true
						? React.createElement(
								'div',
								{
									style: Object.assign(
										{},
										submenuStyle,
										{ zIndex: 82, top: '0px' },
										view.leftward ? { right: '100%', marginRight: '4px' } : { left: '100%', marginLeft: '4px' },
									),
									role: 'menu',
									onPointerDown: function (event) {
										event.stopPropagation()
									},
								},
								React.createElement(
									'button',
									{
										type: 'button',
										role: 'menuitemradio',
										'aria-checked': view.packActive === null ? 'true' : 'false',
										onClick: function () {
											view.onChoosePack(null)
										},
										style: Object.assign({}, menuItemStyle, view.packActive === null ? menuItemActiveStyle : null),
									},
									(view.packActive === null ? '● ' : '   ') + t('menu.builtin'),
								),
								view.packs.map(function (pack) {
									var checked = view.packActive === pack.id
									return React.createElement(
										'button',
										{
											key: pack.id,
											type: 'button',
											role: 'menuitemradio',
											'aria-checked': checked ? 'true' : 'false',
											onClick: function () {
												view.onChoosePack(pack.id)
											},
											style: Object.assign({}, menuItemStyle, checked ? menuItemActiveStyle : null),
										},
										(checked ? '● ' : '   ') + pack.name,
									)
								}),
								React.createElement('div', { style: menuHeadingStyle }),
								item(t('menu.import') + '…', {
									role: 'menuitem',
									onClick: function () {
										view.onImportPack()
									},
								}),
							)
						: null

				var settingsPanel =
					view.settingsOpen === true
						? React.createElement(
								'div',
								{
									style: Object.assign(
										{},
										submenuStyle,
										{ zIndex: 81 },
										view.leftward ? { right: '100%', marginRight: '4px', top: '0px' } : { left: '100%', marginLeft: '4px', top: '0px' },
									),
									role: 'menu',
									onPointerDown: function (event) {
										event.stopPropagation()
									},
								},
								item(t('menu.size') + '  ' + sizeLabel() + '  \u25B8', {
									role: 'menuitem',
									'aria-haspopup': 'true',
									'aria-expanded': view.sizeOpen === true ? 'true' : 'false',
									onPointerEnter: function () {
										if (view.sizeOpen !== true) view.onToggleSize()
									},
									onClick: function () {
										view.onToggleSize()
									},
								}),
								item(t('menu.character') + '  ' + currentPackLabel() + '  \u25B8', {
									role: 'menuitem',
									'aria-haspopup': 'true',
									'aria-expanded': view.characterOpen === true ? 'true' : 'false',
									onPointerEnter: function () {
										if (view.characterOpen !== true) view.onToggleCharacter()
									},
									onClick: function () {
										view.onToggleCharacter()
									},
								}),
								item(t('menu.sound') + '  ' + (view.soundOn === true ? '\u2713' : '\u2717'), {
									role: 'menuitemcheckbox',
									'aria-checked': view.soundOn === true ? 'true' : 'false',
									onClick: function () {
										view.onToggleSound()
									},
								}),
								item(t('menu.roam') + '  ' + (view.roamOn === true ? '\u2713' : '\u2717'), {
									role: 'menuitemcheckbox',
									'aria-checked': view.roamOn === true ? 'true' : 'false',
									onClick: function () {
										view.onToggleRoam()
									},
								}),
								item(t('menu.model') + '  ' + (view.model === 'pro' ? 'V4 Pro' : 'Flash'), {
									role: 'menuitem',
									onClick: function () {
										view.onCycleModel()
									},
								}),
								item(t('menu.low') + '  ' + (view.low === 0 ? t('menu.off') : String(view.low)), {
									role: 'menuitem',
									onClick: function () {
										view.onCycleLow()
									},
								}),
								characterPanel,
								sizePanel,
							)
						: null

				return React.createElement(
					'div',
					{
						style: Object.assign({}, menuStyle, {
							left: Math.min(view.at.x, (typeof window !== 'undefined' ? window.innerWidth : 1024) - 150) + 'px',
							top: Math.min(view.at.y, (typeof window !== 'undefined' ? window.innerHeight : 768) - 96) + 'px',
						}),
						role: 'menu',
						onPointerDown: function (event) {
							event.stopPropagation()
						},
						onContextMenu: function (event) {
							event.preventDefault()
						},
						onKeyDown: view.onKeyDown,
					},
					item(t('menu.settings') + '  \u25B8', {
						role: 'menuitem',
						'aria-haspopup': 'true',
						'aria-expanded': view.settingsOpen === true ? 'true' : 'false',
						onPointerEnter: function () {
							if (view.settingsOpen !== true) view.onToggleSettings()
						},
						onClick: function () {
							view.onToggleSettings()
						},
					}),
					settingsPanel,
					item(t('menu.reset'), {
						role: 'menuitem',
						onClick: function () {
							view.onReset()
						},
					}),
				)
			}

			/**
			 * The widget. Every hook runs before any return, unconditionally — the
			 * one rule this component must not break.
			 */
			function StatusWidget() {
				var clock = React.useState(Date.now())
				var now = clock[0]
				var setNow = clock[1]

				var account = React.useState(null)
				var balance = account[0]
				var setBalance = account[1]

				var fold = React.useState(readCollapsed)
				var collapsed = fold[0]
				var setCollapsed = fold[1]

				var spot = React.useState(function () {
					var initial = currentSize()
					return resolvePlacement(readPlacement(), viewportSize(), frameBox(initial))
				})
				var placement = spot[0]
				var setPlacement = spot[1]

				var art = React.useState(false)
				var artFailed = art[0]

				// Aspect measured from the drawing that actually loaded; null until
				// then, so the constant is only a starting guess.
				var measured = React.useState(null)
				var measuredAspect = measured[0]
				var setMeasuredAspect = measured[1]
				var setArtFailed = art[1]

				var dims = React.useState(currentSize)
				var size = dims[0]
				var setSize = dims[1]

				var spoken = React.useState(null)
				var said = spoken[0]
				var setSaid = spoken[1]

				var popup = React.useState(null)
				var menu = popup[0]
				var setMenu = popup[1]

				var sub = React.useState(false)
				var submenuOpen = sub[0]
				var setSubmenuOpen = sub[1]

				var focus = React.useState(0)
				var focusIndex = focus[0]
				var setFocusIndex = focus[1]

				var settingsOpenState = React.useState(false)
				var settingsOpen = settingsOpenState[0]
				var setSettingsOpen = settingsOpenState[1]

				var sizeOpenState = React.useState(false)
				var sizeOpen = sizeOpenState[0]
				var setSizeOpen = sizeOpenState[1]

				var characterOpenState = React.useState(false)
				var characterOpen = characterOpenState[0]
				var setCharacterOpen = characterOpenState[1]

				var packListState = React.useState(readPacks())
				var packList = packListState[0]
				var setPackList = packListState[1]

				var soundLocal = React.useState(readSound())
				var soundEnabled = soundLocal[0]
				var setSoundEnabled = soundLocal[1]

				var lowLocal = React.useState(readLow())
				var lowValue = lowLocal[0]
				var setLowValue = lowLocal[1]

				var roamLocal = React.useState(readRoam())
				var roamEnabled = roamLocal[0]
				var setRoamEnabled = roamLocal[1]

				var langLocal = React.useState(readLang())
				var langValue = langLocal[0]
				var setLangValue = langLocal[1]

				var modelLocal = React.useState(readModel())
				var modelValue = modelLocal[0]
				var setModelValue = modelLocal[1]

				var cost = React.useState(readTurnCost())
				var costState = cost[0]
				var setCostState = cost[1]

				var wait = React.useState(readApproval())
				var approvalState = wait[0]
				var setApprovalState = wait[1]

				var act = React.useState(activitySnapshot())
				var activityState = act[0]
				var setActivityState = act[1]

				React.useEffect(function () {
					greet()
				}, [])

				React.useEffect(function () {
					refreshPacks()
					return subscribePacks(function () {
						setPackList(readPacks())
					})
				}, [])

				React.useEffect(function () {
					var offs = ['model', 'low', 'roam', 'lang'].map(function (key) {
						return subscribePreference(key, function () {
							setModelValue(readModel())
							setLowValue(readLow())
							setRoamEnabled(readRoam())
							setLangValue(readLang())
						})
					})
					return function () {
						offs.forEach(function (off) {
							off()
						})
					}
				}, [])

				React.useEffect(function () {
					var offSound = subscribeSound(function () {
						setSoundEnabled(readSound())
					})
					return function () {
						offSound()
					}
				}, [])

				React.useEffect(function () {
					return subscribeTurnCost(function () {
						setCostState(readTurnCost())
					})
				}, [])

				React.useEffect(function () {
					return subscribeApproval(function () {
						setApprovalState(readApproval())
					})
				}, [])

				React.useEffect(function () {
					// Drift along the docked edge when nobody is interacting. Docked
					// only: a free-standing widget wandering would be a nuisance.
					var timer = setInterval(function () {
						if (!readRoam() || drag !== null || menu !== null || approval.waiting === true) return
						setPlacement(function (current) {
							if (current.mode !== 'docked') return current
							var box = frameBox(currentSize())
							var max = Math.max(EDGE, viewportSize().height - box.height - EDGE)
							var next = current.bottom + roamDirection * 8
							if (next <= EDGE || next >= max) {
								roamDirection = -roamDirection
								next = Math.min(Math.max(next, EDGE), max)
							}
							return { mode: 'docked', side: current.side, bottom: next }
						})
					}, 3000)
					return function () {
						clearInterval(timer)
					}
				}, [menu])

				React.useEffect(function () {
					// Another tab changed a preference: adopt it rather than showing
					// stale state until a reload.
					function sync() {
						lowState = null
						roamState = null
						langState = null
						applyLow(readLow(), false)
						applyRoam(readRoam(), false)
						applyLang(readLang(), false)
						applySize(window.localStorage.getItem(SIZE_KEY) === null ? 'medium' : window.localStorage.getItem(SIZE_KEY), false)
						applyModel(window.localStorage.getItem(MODEL_KEY) === null ? 'flash' : window.localStorage.getItem(MODEL_KEY), false)
						applySound(window.localStorage.getItem(SOUND_KEY) === '1', false)
						setSize(currentSize())
						setPlacement(resolvePlacement(readPlacement(), viewportSize(), frameBox(currentSize())))
					}
					window.addEventListener('storage', sync)
					return function () {
						window.removeEventListener('storage', sync)
					}
				}, [])

				React.useEffect(function () {
					return subscribeSize(function () {
						setSize(currentSize())
					})
				}, [])

				React.useEffect(function () {
					fetch(PREFS_PATH, { cache: 'no-store' })
						.then(function (response) {
							return response.json()
						})
						.then(function (payload) {
							if (payload === null || payload.ok !== true || typeof payload.prefs !== 'object') return
							var prefs = payload.prefs
							if (typeof prefs.sound === 'boolean') {
								applySound(prefs.sound, false)
							}
							if (typeof prefs.model === 'string') {
								applyModel(prefs.model, false)
							}
							if (typeof prefs.low === 'number') {
								applyLow(prefs.low, false)
							}
							if (typeof prefs.roam === 'boolean') {
								applyRoam(prefs.roam, false)
							}
							if (typeof prefs.lang === 'string') {
								applyLang(prefs.lang, false)
							}
							if (typeof prefs.size === 'string') {
								applySize(prefs.size, false)
								setSize(currentSize())
							}
							if (prefs.mode === 'free' || prefs.side === 'left' || prefs.side === 'right' || Number.isFinite(prefs.bottom)) {
								setPlacement(
									resolvePlacement(prefs, viewportSize(), frameBox(resolveSize(prefs.size))),
								)
							}
						})
						.catch(function () {
							/* the host may not have the route yet; local values stand */
						})
				}, [])

				React.useEffect(function () {
					ensureStyles()
					function onResize() {
						setPlacement(function (current) {
							return resolvePlacement(current, viewportSize(), frameBox(currentSize()))
						})
					}
					var unsubscribe = subscribeActivity(function () {
						setActivityState(activitySnapshot())
					})
					window.addEventListener('resize', onResize)
					return function () {
						unsubscribe()
						window.removeEventListener('resize', onResize)
					}
				}, [])

				React.useEffect(function () {
					var timer = setInterval(function () {
						var at = Date.now()
						setNow(at)
						var boundary = peakChangeLine(at)
						if (boundary !== null) {
							setSaid({ text: boundary, at: at })
							cue('alert')
							return
						}
						var act = idleAct(at, activity.busy !== true && approval.waiting !== true)
						if (act !== null) setSaid({ text: act, at: at })
					}, 1000)
					return function () {
						clearInterval(timer)
					}
				}, [])

				React.useEffect(function () {
					if (menu === null) return
					function close() {
						setMenu(null)
					}
					function onKey(event) {
						if (event.key === 'Escape') close()
					}
					document.addEventListener('pointerdown', close)
					document.addEventListener('keydown', onKey)
					return function () {
						document.removeEventListener('pointerdown', close)
						document.removeEventListener('keydown', onKey)
					}
				}, [menu])

				React.useEffect(function () {
					var cancelled = false
					function read() {
						fetch(BALANCE_PATH, { cache: 'no-store' })
							.then(function (response) {
								return response.json()
							})
							.then(function (payload) {
								if (cancelled) return
								var wasBroken = lastBalance !== null && lastBalance.ok === false
								// A top-up is the one happy event money can bring.
								if (balanceIncreased(totalsOf(lastBalance), totalsOf(payload))) balanceRose()
								lastBalance = payload
								setBalance(payload)
								if (payload.ok === false && !wasBroken) cue('error')
								var low = lowBalanceLine(payload, readLow())
								if (low !== null && Date.now() > watched.lowUntil) {
									watched.lowUntil = Date.now() + 3600000
									setSaid({ text: low, at: Date.now() })
									cue('error')
								}
							})
							.catch(function () {
								if (cancelled) return
								var failed = { ok: false, reason: 'unreachable', at: Date.now() }
								if (lastBalance === null || lastBalance.ok !== false) cue('error')
								lastBalance = failed
								setBalance(failed)
							})
					}
					read()
					var timer = setInterval(read, BALANCE_POLL_MS)
					function onVisible() {
						if (typeof document !== 'undefined' && document.visibilityState === 'visible') read()
					}
					if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
					return function () {
						cancelled = true
						clearInterval(timer)
						if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
					}
				}, [])

				var status = describe(now)
				var money = readBalance(balance)
				var mainId = runtime.sessions === undefined ? null : mainSessionId(runtime.sessions)
				var pressure = readPressure(runtime.sessions, mainId)
				var face = approvalState.waiting === true ? 'busy' : resolveFace(status, balance, activityState, now)
				// After `face`: a sheet is per state, so the lookup needs it.
				var sheet = sheetFor(face)
				/**
				 * The drawing's height over its width, for layout and for the hit zone.
				 *
				 * It cannot be a constant: the built-in cat is 432x620 and a pack's
				 * poses are 432x788, so a fixed ratio puts her box — and the head-pat
				 * zone — in the wrong place as soon as the character changes.
				 */
				var artAspect = sheet !== null && sheet.frameWidth > 0 ? sheet.frameHeight / sheet.frameWidth : measuredAspect === null ? ART_RATIO : measuredAspect
				// Open the submenu leftward when there is no room to the right.
				var leftward = menu !== null && menu.x + SUBMENU_WIDTH > viewportSize().width
				var line = approvalState.waiting === true ? t('waiting') : status.text
				var title =
					(approvalState.waiting === true ? 'A turn is waiting for your approval.\n\n' : '') +
					status.title +
					(pressure !== null && pressure.ratio !== null
						? '\n\nContext ' + Math.round(pressure.ratio * 100) + '% (' + pressure.used + ' of ' + pressure.window + ' tokens).'
						: '') +
					'\n\n' +
					money.title

				function toggle() {
					var next = !collapsed
					setCollapsed(next)
					writeCollapsed(next)
				}

				/**
				 * Speak *and* make sure there is somewhere to say it. The line renders
				 * on the bubble's second row, which a collapsed bubble hides — so a
				 * click on a collapsed widget looked like nothing happened.
				 */
				function speak() {
					setSaid({ text: nextLine(face), at: Date.now() })
					if (collapsed) {
						setCollapsed(false)
						writeCollapsed(false)
					}
				}

				function onContextMenu(event) {
					if (typeof event.preventDefault === 'function') event.preventDefault()
					setSubmenuOpen(false)
					setMenu({ x: event.clientX, y: event.clientY })
				}

				/**
				 * Keyboard parity for the pointer gestures: Shift+F10 (or the
				 * ContextMenu key) opens the menu at the widget, Enter and Space speak.
				 * The menu's items are real buttons, so Tab and Enter work inside it
				 * without a roving focus implementation.
				 */
				function onKeyDown(event) {
					var wantsMenu = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
					if (wantsMenu) {
						event.preventDefault()
						var box = typeof event.currentTarget.getBoundingClientRect === 'function' ? event.currentTarget.getBoundingClientRect() : null
						setSubmenuOpen(false)
						setMenu({ x: box === null ? 120 : box.right, y: box === null ? 120 : box.top })
						return
					}
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault()
						speak()
					}
				}

				/** Arrow keys move the highlight; Enter picks it; Escape is handled at the document. */
				function onMenuKeyDown(event) {
					if (!sizeOpen) {
						// Only steal the key when a menu row is not already focused:
						// Enter on a button must press that button.
						var onButton = typeof event.target === 'object' && event.target !== null && event.target.tagName === 'BUTTON'
						if (!onButton && (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight')) {
							event.preventDefault()
							var next = nextSubmenu({ sizeOpen: sizeOpen, characterOpen: characterOpen }, 'size')
							setSizeOpen(next.sizeOpen)
							setCharacterOpen(next.characterOpen)
							setFocusIndex(SIZES.findIndex(function (option) { return option.id === size.id }))
						}
						return
					}
					if (event.key === 'ArrowDown') {
						event.preventDefault()
						setFocusIndex((focusIndex + 1) % SIZES.length)
						return
					}
					if (event.key === 'ArrowUp') {
						event.preventDefault()
						setFocusIndex((focusIndex - 1 + SIZES.length) % SIZES.length)
						return
					}
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault()
						chooseSize(SIZES[focusIndex].id)
					}
				}

				function chooseSize(id) {
					applySize(id)
					setSize(currentSize())
					setSubmenuOpen(false)
					setMenu(null)
				}

				function onPointerDown(event) {
					if (event.button !== undefined && event.button !== 0) return
					var rect = typeof event.currentTarget.getBoundingClientRect === 'function' ? event.currentTarget.getBoundingClientRect() : null
					drag = {
						pointerId: event.pointerId,
						x: event.clientX,
						y: event.clientY,
						// Where the pointer sits inside the widget, so the drop keeps
						// her under the same spot on the body rather than jumping.
						offsetX: rect === null ? 0 : event.clientX - rect.left,
						offsetY: rect === null ? 0 : event.clientY - rect.top,
						rectHeight: rect === null ? 0 : rect.height,
						moved: false,
						spot: null,
						onControl: typeof event.target.closest === 'function' && event.target.closest('button') !== null,
					}
					if (typeof event.currentTarget.setPointerCapture === 'function') {
						event.currentTarget.setPointerCapture(event.pointerId)
					}
				}

				function onPointerMove(event) {
					if (drag === null || event.pointerId !== drag.pointerId) return
					var dy = event.clientY - drag.y
					var dx = event.clientX - drag.x
					if (!drag.moved && Math.abs(dx) + Math.abs(dy) > CLICK_SLOP) drag.moved = true
					if (!drag.moved) return
					drag.spot = dropTarget({
						pointerX: event.clientX,
						pointerY: event.clientY,
						offsetX: drag.offsetX,
						offsetY: drag.offsetY,
						box: characterBox(size, artAspect),
						inset: (FRAME_WIDTH - size.width) / 2,
						viewport: viewportSize(),
						dockedNow: placement.mode === 'docked',
						dockedSide: placement.side,
					})
					setPlacement(drag.spot)
					if (typeof event.preventDefault === 'function') event.preventDefault()
				}

				function onPointerUp(event) {
					if (drag === null || event.pointerId !== drag.pointerId) return
					var moved = drag.moved
					var onControl = drag.onControl
					// The zone follows the drawing on screen, not a fixed ratio, so a
					// taller pack pose moves her head down with it.
					var dragPat = isPatZone(drag.offsetY, drag.rectHeight, characterBox(size, artAspect).height)
					// Re-decide at the release point: a fast flick can leave the pointer
					// somewhere the last move event never sampled.
					var spot = moved
						? dropTarget({
								pointerX: event.clientX,
								pointerY: event.clientY,
								offsetX: drag.offsetX,
								offsetY: drag.offsetY,
								box: characterBox(size, artAspect),
								inset: (FRAME_WIDTH - size.width) / 2,
								viewport: viewportSize(),
								dockedNow: placement.mode === 'docked',
								dockedSide: placement.side,
							})
						: null
					drag = null
					if (moved && spot !== null) {
						writePlacement(spot)
						savePrefs(
							spot.mode === 'free'
								? { mode: 'free', x: Math.round(spot.x), y: Math.round(spot.y) }
								: { mode: 'docked', side: spot.side, bottom: Math.round(spot.bottom) },
						)
						return
					}
					if (onControl) return
					// A press on the top third is a head pat; anywhere else is a word.
					if (dragPat === true) {
						patCount++
						setSaid({ text: patLine(patCount), at: Date.now() })
						patLanded()
						cue('done')
						return
					}
					speak()
				}

				function resetWidget() {
					applySize('medium')
					setSize(currentSize())
					var fresh = { mode: 'docked', side: 'right', bottom: 24 }
					setPlacement(resolvePlacement(fresh, viewportSize(), frameBox(currentSize())))
					writePlacement(fresh)
					savePrefs(fresh)
					setMenu(null)
					setSubmenuOpen(false)
					setSettingsOpen(false)
					setSizeOpen(false)
					setCharacterOpen(false)
				}

				var menuView = {
					at: menu === null ? { x: 0, y: 0 } : menu,
					open: submenuOpen,
					// The widget was computed this and then threw it away, so the
					// submenu never actually flipped away from the screen edge.
					leftward: leftward,
					focusIndex: focusIndex,
					current: size.id,
					onChoose: chooseSize,
					onKeyDown: onMenuKeyDown,
					settingsOpen: settingsOpen,
					sizeOpen: sizeOpen,
					onToggleSize: function () {
						var next = nextSubmenu({ sizeOpen: sizeOpen, characterOpen: characterOpen }, 'size')
						setSizeOpen(next.sizeOpen)
						setCharacterOpen(next.characterOpen)
					},
					characterOpen: characterOpen,
					onToggleCharacter: function () {
						var next = nextSubmenu({ sizeOpen: sizeOpen, characterOpen: characterOpen }, 'character')
						setSizeOpen(next.sizeOpen)
						setCharacterOpen(next.characterOpen)
					},
					packs: packList.packs,
					packActive: packList.active,
					onImportPack: function () {
						pickPackFile(function (result) {
							if (result.ok !== true) return
							setMenu(null)
							setSettingsOpen(false)
							setCharacterOpen(false)
						})
					},
					onChoosePack: function (id) {
						choosePack(id)
						setMenu(null)
						setSettingsOpen(false)
						setSizeOpen(false)
						setCharacterOpen(false)
					},
					onToggleSettings: function () {
						var opening = !settingsOpen
						setSettingsOpen(opening)
						setSizeOpen(false)
						setCharacterOpen(false)
					},
					low: lowValue,
					model: modelValue,
					onCycleModel: function () {
						applyModel(modelValue === 'pro' ? 'flash' : 'pro')
						setModelValue(readModel())
					},
					onCycleLow: function () {
						var order = [0, 5, 10, 25]
						var index = Math.max(0, order.indexOf(lowValue))
						var next = order[(index + 1) % order.length]
						applyLow(next)
						setLowValue(next)
					},
					soundOn: soundEnabled,
					roamOn: roamEnabled,
					onToggleSound: function () {
						applySound(!soundEnabled)
					},
					onToggleRoam: function () {
						applyRoam(!readRoam())
					},
					onToggle: function () {
						setSubmenuOpen(!submenuOpen)
					},
					onReset: resetWidget,
				}


				var layout = layoutFor(placement, size, artAspect)
				var rowStyle = layout.root
				var bubblePlacementStyle = layout.bubble
				var tailStyle = layout.tail

				return React.createElement(
					'div',
					{
						style: rowStyle,
						title: title,
						'data-dsh-status-widget': 'true',
						onPointerDown: onPointerDown,
						onPointerMove: onPointerMove,
						onPointerUp: onPointerUp,
						onPointerCancel: onPointerUp,
						onContextMenu: onContextMenu,
						onKeyDown: onKeyDown,
						tabIndex: 0,
						role: 'group',
						'aria-label': 'Account balance and DeepSeek rate status',
					},
					React.createElement(
						'div',
						{ style: bubblePlacementStyle },
						React.createElement(
							'div',
							{ style: { display: 'flex', alignItems: 'center', gap: '6px' } },
							React.createElement(
								'span',
								{ style: { fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', lineHeight: 1.2 } },
								money.text,
							),
							React.createElement(
								'button',
								{
									type: 'button',
									onClick: toggle,
									'aria-label': collapsed ? 'Expand rate and balance' : 'Collapse to balance',
									style: buttonStyle,
								},
								collapsed ? '+' : '–',
							),
						),
						collapsed
							? null
							: React.createElement(
									'div',
									{ style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' } },
									React.createElement('span', {
										'aria-hidden': 'true',
										className: 'dshsw-dot',
										'data-waiting': approvalState.waiting === true ? 'true' : 'false',
										style: {
											width: '8px',
											height: '8px',
											borderRadius: '50%',
											flex: '0 0 auto',
											background: approvalState.waiting === true ? '#e5484d' : dotColor(status),
										},
									}),
									React.createElement(
										'span',
										{ style: rateLineStyle },
										said !== null && now - said.at < LINE_MS ? said.text : line,
									),
								),
						pressure !== null && pressure.ratio !== null && !collapsed
							? React.createElement(
									'div',
									{ style: pressureBarStyle(pressure) },
									React.createElement('div', {
										style: Object.assign({}, pressureFillStyle, {
											width: Math.round(pressure.ratio * 100) + '%',
											background: pressure.ratio >= 0.9 ? '#e5484d' : pressure.ratio >= 0.7 ? '#f5a524' : '#3fb950',
										}),
									}),
								)
							: null,
						costState !== null && now - costState.at < 60000 && !collapsed
							? React.createElement('div', { style: costLineStyle }, 'Last turn ' + formatUsd(costState.usd))
							: null,
						React.createElement('span', { style: tailStyle }),
					),
					sheet !== null
						? React.createElement('div', {
								className: 'dshsw-body',
								'data-state': face,
								style: Object.assign(
									{},
									layout.character,
									// Scale the frame to the widget's current size, so a sheet
									// matches a still pose at every size setting.
									spriteStyle(sheet, sheet.frameWidth > 0 ? size.width / sheet.frameWidth : 1),
									{ filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.3))' },
								),
							})
						: artFailed
						? // The drawing did not load. An empty box keeps the layout honest;
							// a stand-in character would be a different animal.
							React.createElement('div', { className: 'dshsw-body', 'data-state': face, style: layout.character })
						: React.createElement('img', {
								className: 'dshsw-body dshsw-still',
								'data-state': face,
								src: (packList.active === null ? MASCOT_PATH : PACK_BASE + '/character.png') + '?state=' + face,
								alt: '',
								draggable: false,
								onLoad: function (event) {
									var element = event === undefined ? undefined : event.currentTarget ?? event.target
									if (element === undefined || !(element.naturalWidth > 0)) return
									var next = element.naturalHeight / element.naturalWidth
									setMeasuredAspect(function (current) {
										return Math.abs((current ?? 0) - next) < 0.001 ? current : next
									})
								},
								onError: function () {
									setArtFailed(true)
								},
								style: Object.assign({}, imageStyle, layout.character),
							}),
					menu === null ? null : renderMenu(menuView),
				)
			}

			/**
			 * Which face to wear. Turn-driven states arrive with the event
			 * subscription; until then the character reacts to what we poll.
			 */
			function characterState(status, payload) {
				if (payload !== null && payload.ok === false) return 'worried'
				if (payload !== null && payload.ok === true && !status.peak) return 'happy'
				return 'idle'
			}
			//#endregion

			/** Exactly the character's box; the bubble hangs outside it. */
			/**
			 * Every inline style the widget needs, as a function of placement and
			 * size. Pure, so the layout can be asserted for all three modes without
			 * driving React state — every visual regression so far lived here.
			 */
			function layoutFor(placement, size, aspect) {
				var art = characterBox(size, aspect)
				var frame = frameBox(size, aspect)

				// The widget is a column of two centred things. No transforms and no
				// absolute positioning for layout: the bob animation animates `transform`,
				// and CSS animations outrank inline styles — centring with translateX was
				// silently cancelled by the animation, which is why she drifted.
				var root = {
					position: 'fixed',
					zIndex: 60,
					width: frame.width + 'px',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					cursor: 'grab',
					touchAction: 'none',
				}
				if (placement.mode === 'free') {
					root.left = placement.x + 'px'
					root.top = placement.y + 'px'
				} else {
					root[placement.side] = DOCK_MARGIN + 'px'
					root.bottom = placement.bottom + 'px'
				}

				// The bubble is centred by the frame's alignItems, and wraps at the frame
				// width. Same shape in every mode, because the frame never changes width.
				var bubble = Object.assign({}, bubbleStyle, {
					position: 'relative',
					width: 'max-content',
					maxWidth: '100%',
					marginBottom: '6px',
				})

				var tail = {
					position: 'absolute',
					bottom: '-6px',
					left: '50%',
					marginLeft: '-5.5px',
					width: '11px',
					height: '11px',
					background: 'Canvas',
					borderRight: '1px solid rgba(127,127,127,0.3)',
					borderBottom: '1px solid rgba(127,127,127,0.3)',
					transform: 'rotate(45deg)',
				}

				// The character: second in the column, centred by the frame, flipped with
				// the standalone `scale` property so the bob animation cannot undo it.
				var character = {
					width: size.width + 'px',
					height: art.height + 'px',
					display: 'block',
				}
				if (placement.mode === 'docked' && placement.side === 'left') character.scale = '-1 1'

				return { root: root, bubble: bubble, tail: tail, character: character }
			}

			/** The PNG carries no padding, so width alone sizes it. */
			var imageStyle = {
				height: 'auto',
				display: 'block',
				filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.3))',
			}

			/**
			 * The card is a speech bubble: her line of dialogue, with a tail that
			 * points down at her. The tail is a rotated square sharing the bubble's
			 * background and border, so the outline stays continuous.
			 */
			var bubbleStyle = {
				position: 'absolute',
				bottom: '100%',
				marginBottom: '6px',
				// A long line wraps instead of stretching the corner out of the
				// viewport; the character's position never depends on this width.
				// `width: max-content` is required: an absolutely positioned child is
				// otherwise shrink-to-fit inside the containing block, which is only as
				// wide as the character — the bubble would be squeezed to her width.
				width: 'max-content',
				display: 'flex',
				flexDirection: 'column',
				padding: '7px 10px',
				borderRadius: '12px',
				background: 'Canvas',
				color: 'CanvasText',
				border: '1px solid rgba(127,127,127,0.3)',
				boxShadow: '0 3px 12px rgba(0,0,0,0.18)',
				fontFamily: 'system-ui, sans-serif',
				lineHeight: '1.4',
				userSelect: 'none',
				textWrap: 'pretty',
			}

			var costLineStyle = {
				fontSize: '11px',
				opacity: 0.7,
				whiteSpace: 'nowrap',
				marginTop: '1px',
			}

			var rateLineStyle = {
				fontSize: '12px',
				opacity: 0.85,
				whiteSpace: 'normal',
			}

			var buttonStyle = {
				marginLeft: '2px',
				border: 'none',
				background: 'transparent',
				color: 'inherit',
				cursor: 'pointer',
				fontSize: '12px',
				lineHeight: 1,
				padding: '0 2px',
				opacity: 0.6,
			}

			var menuStyle = {
				position: 'fixed',
				zIndex: 80,
				minWidth: '120px',
				display: 'flex',
				flexDirection: 'column',
				gap: '1px',
				padding: '4px',
				borderRadius: '8px',
				background: 'Canvas',
				color: 'CanvasText',
				border: '1px solid rgba(127,127,127,0.35)',
				boxShadow: '0 6px 18px rgba(0,0,0,0.22)',
				fontFamily: 'system-ui, sans-serif',
				fontSize: '12px',
				userSelect: 'none',
			}

			/** Enough room for a submenu before it would leave the viewport. */
			var SUBMENU_WIDTH = 290

			var submenuStyle = {
				position: 'absolute',
				top: 0,
				zIndex: 81,
				minWidth: '128px',
				display: 'flex',
				flexDirection: 'column',
				gap: '1px',
				padding: '4px',
				borderRadius: '8px',
				background: 'Canvas',
				color: 'CanvasText',
				border: '1px solid rgba(127,127,127,0.35)',
				boxShadow: '0 6px 18px rgba(0,0,0,0.22)',
			}

			var menuHeadingStyle = {
				padding: '2px 8px 4px',
				opacity: 0.6,
				fontSize: '11px',
				textTransform: 'uppercase',
				letterSpacing: '0.04em',
			}

			var menuItemStyle = {
				border: 'none',
				background: 'transparent',
				color: 'inherit',
				textAlign: 'left',
				font: 'inherit',
				fontSize: '12px',
				padding: '5px 8px',
				borderRadius: '5px',
				cursor: 'pointer',
				whiteSpace: 'pre',
			}

			var menuItemActiveStyle = {
				background: 'rgba(127,127,127,0.18)',
				fontWeight: 600,
			}

			/** Keyboard focus ring, distinct from the selected item. */
			var menuItemFocusStyle = {
				outline: '2px solid rgba(127,127,127,0.7)',
				outlineOffset: '-2px',
			}

			/** Settings → Status widget: the size control, sharing the widget's store. */
			function SettingsPanel() {
				var local = React.useState(currentSize())
				var chosen = local[0]
				var setChosen = local[1]

				var lowLocal = React.useState(readLow())
				var low = lowLocal[0]
				var setLow = lowLocal[1]

				var lowLocal = React.useState(readLow())
				var lowValue = lowLocal[0]
				var setLowValue = lowLocal[1]

				var roamLocal = React.useState(readRoam())
				var roam = roamLocal[0]
				var setRoam = roamLocal[1]

				var langLocal = React.useState(readLang())
				var langValue = langLocal[0]
				var setLangValue = langLocal[1]

				var modelLocal = React.useState(readModel())
				var model = modelLocal[0]
				var setModel = modelLocal[1]

				var soundLocal = React.useState(readSound())
				var on = soundLocal[0]
				var setOn = soundLocal[1]

				React.useEffect(function () {
					var offSize = subscribeSize(function () {
						setChosen(currentSize())
					})
					var offSound = subscribeSound(function () {
						setOn(readSound())
					})
					var offCost = subscribeTurnCost(function () {
						setModel(readModel())
					})
					return function () {
						offSize()
						offSound()
						offCost()
					}
				}, [])

				return React.createElement(
					'div',
					{ style: { padding: '4px 0', fontFamily: 'system-ui, sans-serif' } },
					React.createElement('div', { style: { fontWeight: 600, marginBottom: '6px' } }, 'Mascot size'),
					React.createElement(
						'div',
						{ style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
						SIZES.map(function (option) {
							return React.createElement(
								'button',
								{
									key: option.id,
									type: 'button',
									onClick: function () {
										applySize(option.id)
									},
									style: Object.assign({}, chipStyle, chosen.id === option.id ? chipActiveStyle : null),
								},
								option.label,
							)
						}),
					),
					React.createElement(
						'div',
						{ style: { fontWeight: 600, margin: '12px 0 6px' } },
						'Character',
					),
					React.createElement(CharacterSettings),
					React.createElement(
						'div',
						{ style: { fontWeight: 600, margin: '12px 0 6px' } },
						'Pricing model',
					),
					React.createElement(
						'div',
						{ style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
						MODELS.map(function (id) {
							return React.createElement(
								'button',
								{
									key: id,
									type: 'button',
									onClick: function () {
										applyModel(id)
									},
									style: Object.assign({}, chipStyle, model === id ? chipActiveStyle : null),
								},
								id === 'flash' ? 'Flash' : 'V4 Pro',
							)
						}),
					),
					React.createElement(
						'div',
						{ style: { opacity: 0.6, fontSize: '12px', marginTop: '8px', maxWidth: '44ch' } },
						'Used to price the last turn.'),
					React.createElement(
						'div',
						{ style: { fontWeight: 600, margin: '12px 0 6px' } },
						'Low-balance warning',
					),
					React.createElement(
						'div',
						{ style: { display: 'flex', gap: '6px', alignItems: 'center' } },
						[0, 5, 10, 25].map(function (value) {
							return React.createElement(
								'button',
								{
									key: value,
									type: 'button',
									onClick: function () {
										applyLow(value)
										setLow(value)
									},
									style: Object.assign({}, chipStyle, low === value ? chipActiveStyle : null),
								},
								value === 0 ? 'Off' : String(value),
							)
						}),
					),
					React.createElement(
						'div',
						{ style: { fontWeight: 600, margin: '12px 0 6px' } },
						'Roaming',
					),
					React.createElement(
						'button',
						{
							type: 'button',
							onClick: function () {
								applyRoam(!roam)
								setRoam(!roam)
							},
							style: Object.assign({}, chipStyle, roam ? chipActiveStyle : null),
						},
						roam ? 'Drifts when idle' : 'Stays put',
					),
					React.createElement(
						'div',
						{ style: { fontWeight: 600, margin: '12px 0 6px' } },
						'Sound',
					),
					React.createElement(
						'button',
						{
							type: 'button',
							onClick: function () {
								applySound(!on)
							},
							style: Object.assign({}, chipStyle, on ? chipActiveStyle : null),
						},
						on ? 'Cues on' : 'Cues off',
					),
					React.createElement(
						'div',
						{ style: { opacity: 0.6, fontSize: '12px', marginTop: '8px', maxWidth: '44ch' } },
						'Off by default.'),

				)
			}

			/**
			 * Character packs in Settings: import a `.dshchar`, switch between
			 * installed packs, export one back out, or delete one.
			 */
			function CharacterSettings() {
				var packsState = React.useState({ ready: false, active: null, packs: [] })
				var state = packsState[0]
				var setState = packsState[1]
				var noticeState = React.useState(null)
				var notice = noticeState[0]
				var setNotice = noticeState[1]

				function refresh() {
					fetch(PACK_BASE + '/characters', { cache: 'no-store' })
						.then(function (response) {
							return response.json()
						})
						.then(function (payload) {
							if (payload !== null && payload.ok === true) setState({ ready: true, active: payload.active, packs: payload.packs || [] })
						})
						.catch(function () {
							setState({ ready: true, active: null, packs: [] })
						})
				}

				React.useEffect(function () {
					refresh()
					var offs = ['model', 'low', 'roam', 'lang'].map(function (key) {
						return subscribePreference(key, function () {
							setModel(readModel())
							setLow(readLow())
							setRoam(readRoam())
							setLang(readLang())
						})
					})
					return function () {
						offs.forEach(function (off) {
							off()
						})
					}
				}, [])

				function call(method, path, body) {
					fetch(PACK_BASE + path, {
						method: method,
						headers: body === undefined ? undefined : { 'content-type': 'application/json' },
						body: body === undefined ? undefined : JSON.stringify(body),
					})
						.then(function (response) {
							return response.json()
						})
						.then(function (payload) {
							if (payload !== null && payload.ok === false) {
								setNotice('Refused: ' + (payload.errors || []).join(', '))
							} else {
								setNotice(null)
							}
							refresh()
						})
						.catch(function () {
							setNotice('The host did not answer')
						})
				}

				function onFile(event) {
					var file = event.target.files !== undefined ? event.target.files[0] : undefined
					if (file === undefined) return
					var reader = new FileReader()
					reader.onload = function () {
						try {
							call('POST', '/characters', JSON.parse(String(reader.result)))
						} catch {
							setNotice('That file is not JSON')
						}
					}
					reader.onerror = function () {
						resolve({ ok: false, errors: ['read-failed'] })
					}
					reader.readAsText(file)
				}

				return React.createElement(
					'div',
					null,
					React.createElement(
						'div',
						{ style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
						React.createElement('label', { style: Object.assign({}, chipStyle, { cursor: 'pointer' }) }, 'Import .dshchar', React.createElement('input', { type: 'file', accept: '.dshchar,application/json', onChange: onFile, style: { display: 'none' } })),
						React.createElement(
							'button',
							{
								type: 'button',
								onClick: function () {
									call('DELETE', '/characters/active')
								},
								style: chipStyle,
							},
							'Use built-in',
						),
					),
					state.packs.length === 0
						? React.createElement('div', { style: { opacity: 0.6, fontSize: '12px', marginTop: '6px' } }, 'No packs installed.')
						: React.createElement(
								'div',
								{ style: { display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' } },
								state.packs.map(function (pack) {
									var active = pack.id === state.active
									return React.createElement(
										'div',
										{ key: pack.id, style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
										React.createElement('span', { style: { fontSize: '12px', fontWeight: active ? 600 : 400 } }, pack.name + (active ? ' ●' : '')),
										React.createElement(
											'button',
											{
												type: 'button',
												onClick: function () {
													call('POST', '/characters/' + pack.id + '/active')
												},
												style: chipStyle,
											},
											'Use',
										),
										React.createElement(
											'button',
											{
												type: 'button',
												onClick: function () {
													call('DELETE', '/characters/' + pack.id)
												},
												style: chipStyle,
											},
											'Delete',
										),
									)
								}),
							),
					notice === null ? null : React.createElement('div', { style: { color: '#e5484d', fontSize: '12px', marginTop: '6px' } }, notice),
				)
			}

			var chipStyle = {
				border: '1px solid rgba(127,127,127,0.35)',
				background: 'transparent',
				color: 'inherit',
				borderRadius: '999px',
				padding: '4px 12px',
				cursor: 'pointer',
				font: 'inherit',
				fontSize: '12px',
			}

			var chipActiveStyle = {
				background: 'rgba(127,127,127,0.22)',
				fontWeight: 600,
			}

			var inject = ['slots']

			/** Register into the shell overlay: a root-scoped list slot. */
			function apply(ctx) {
				// Session status — running, pending interactions, turn boundaries — is
				// one push-based store. Optional: a composition without the ui-session
				// service still gets the widget, just without the reactive faces.
				var uiSession = typeof ctx.get === 'function' ? ctx.get('uiSession') : undefined
				var sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
				runtime.sessions = sessions
				// One source for "running": the same status store that reports pending
				// interactions. Two sources would eventually disagree, and the turn
				// boundaries we need for cost come from this one anyway.
				if (uiSession !== undefined && uiSession.sessionStatus !== undefined && typeof uiSession.sessionStatus.subscribe === 'function') {
					ctx.effect(function () {
						var baseline = new Map()
						var previous = new Map()
						function read() {
							var snapshot
							try {
								snapshot = uiSession.sessionStatus.getSnapshot()
							} catch {
								return
							}
							if (!(snapshot instanceof Map)) return
							var anyRunning = false
							snapshot.forEach(function (status, id) {
								var was = previous.get(id)
								var now = status !== undefined && status.running === true
								if (now) anyRunning = true
								if (now !== was) {
									if (now) {
										// Capture the cumulative usage at the start of the turn.
										baseline.set(id, readUsage(sessions, id))
									} else if (was === true) {
										var before = baseline.get(id)
										baseline.delete(id)
										var delta = usageDelta(before === undefined ? null : before, readUsage(sessions, id))
										if (delta !== null) publishTurnCost(costOf(delta, isPeak(Date.now()), readModel()), delta)
									}
									previous.set(id, now)
								}
							})
							setBusy(anyRunning)
							readPendingFrom(uiSession, sessions)
						}
						var off = uiSession.sessionStatus.subscribe(read)
						read()
						return function () {
							if (typeof off === 'function') off()
						}
					}, 'status-widget: session status')
				}

				ctx.slots.inject('shell.overlay', function () {
					return ctx.slots.register({ name: 'shell.overlay', id: 'status-widget' }, StatusWidget)
				})

				ctx.slots.inject('settings.section', function () {
					return ctx.slots.register(
						{
							name: 'settings.section',
							id: 'status-widget',
							order: 60,
							label: function () {
								return 'Status widget'
							},
						},
						SettingsPanel,
					)
				})
			}

			exports.apply = apply
			exports.inject = inject
			exports.StatusWidget = StatusWidget
			/** Exposed so the node tests can drive the schedule and the formatting. */
			exports.__schedule = {
				PEAK_BLOCKS: PEAK_BLOCKS,
				HOLIDAYS: HOLIDAYS,
				isPeak: isPeak,
				beijingDate: beijingDate,
				holidaySpan: holidaySpan,
				holidayDataKnown: holidayDataKnown,
				nextTransition: nextTransition,
				formatDuration: formatDuration,
				describe: describe,
			}
			exports.SettingsPanel = SettingsPanel
			exports.renderMenu = renderMenu
			exports.__dialogue = { LINES: LINES, nextLine: nextLine, LINE_MS: LINE_MS }
			exports.__prefs = { savePrefs: savePrefs, applySize: applySize, currentSize: currentSize, subscribeSize: subscribeSize }
			exports.nextSubmenu = nextSubmenu
			exports.__balance = { formatBalances: formatBalances, readBalance: readBalance, totalsOf: totalsOf, balanceIncreased: balanceIncreased }
			exports.__prefsWatch = { subscribePreference: subscribePreference }
			exports.__pat = { isPatZone: isPatZone }
			exports.__packs = {
				importPackFile: importPackFile,
				readPacks: readPacks,
				subscribePacks: subscribePacks,
				refreshPacks: refreshPacks,
				choosePack: choosePack,
				/** Publish a pack list as if the host had answered. */
				setPacksForTest: function (next) {
					packsState = next
					for (var i = 0; i < packListeners.length; i++) packListeners[i]()
				},
				setActivePack: setActivePack,
				activePackState: activePackState,
				sheetFor: sheetFor,
				spriteStyle: spriteStyle,
				spriteKeyframes: spriteKeyframes,
				sheetGrid: sheetGrid,
				setPackSound: function (event, url) {
					if (url === null) delete packSounds[event]
					else packSounds[event] = url
				},
				packSounds: function () {
					return Object.keys(packSounds)
				},
			}
			exports.__lang = { t: t, readLang: readLang, applyLang: applyLang, TEXT: TEXT }
			exports.__prefs2 = { readLow: readLow, applyLow: applyLow, readRoam: readRoam, applyRoam: applyRoam }
			exports.__watching = {
				peakChangeLine: peakChangeLine,
				lowBalanceLine: lowBalanceLine,
				idleAct: idleAct,
				IDLE_ACTS: IDLE_ACTS,
				reset: function () {
					watched.peak = null
					idleActAt = 0
				},
			}
			exports.__pressure = { readPressure: readPressure, pressureBarStyle: pressureBarStyle }
			exports.__runtime = runtime
			exports.__cost = {
				RATES: RATES,
				MODELS: MODELS,
				costOf: costOf,
				usageDelta: usageDelta,
				readUsage: readUsage,
				formatUsd: formatUsd,
				readModel: readModel,
				applyModel: applyModel,
				publishTurnCost: publishTurnCost,
				readTurnCost: readTurnCost,
				subscribeTurnCost: subscribeTurnCost,
			}
			exports.__approvals = {
				readApproval: readApproval,
				setWaiting: setWaiting,
				subscribeApproval: subscribeApproval,
				mainSessionId: mainSessionId,
				readPendingFrom: readPendingFrom,
			}
			exports.__sound = { readSound: readSound, applySound: applySound, subscribeSound: subscribeSound, cue: cue }
			exports.__menu = {
				SIZES: SIZES,
				DEFAULT_SIZE: DEFAULT_SIZE,
				DOCK_MARGIN: DOCK_MARGIN,
				resolveSize: resolveSize,
				readSize: readSize,
				writeSize: writeSize,
				ART_RATIO: ART_RATIO,
			}
			exports.__character = {
				CHARACTER_STATES: CHARACTER_STATES,
				characterState: characterState,
				resolveFace: resolveFace,
				activitySnapshot: activitySnapshot,
				resolveSize: resolveSize,
				DEFAULT_SIZE: DEFAULT_SIZE,
				DOCK_MARGIN: DOCK_MARGIN,
				setBusy: setBusy,
				subscribeActivity: subscribeActivity,
				dropTarget: dropTarget,
				characterBox: characterBox,
				frameBox: frameBox,
				FRAME_WIDTH: FRAME_WIDTH,
				BUBBLE_MAX: BUBBLE_MAX,
				layoutFor: layoutFor,
				clamp: clamp,
				resolvePlacement: resolvePlacement,
			}
			return module.exports
		},
	})
})()
