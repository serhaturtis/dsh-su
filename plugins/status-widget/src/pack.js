/**
 * Character packs: the format, and the rules that decide whether a pack is one.
 *
 * Kept free of Node and DOM so the same code can validate in the host (before
 * writing anything to disk), in the browser (before uploading), and in the
 * tests. A format whose rules live only in a UI is a format nobody can
 * implement twice, which is the whole point of this file.
 */

/** The schema this build understands. Bumped only for breaking changes. */
export const SCHEMA = 1

/**
 * Poses the widget can render. `idle` is required; the rest fall back to it.
 *
 * Every state here is chosen by a real signal, in this order of precedence:
 * busy (a turn is running), pat (a pat just landed), party (the balance went
 * up), wave (first sighting), happy (a turn just finished), worried (the read
 * failed), sleepy (nothing has happened for ten minutes), idle.
 */
export const POSES = ['idle', 'happy', 'busy', 'worried', 'sleepy', 'wave', 'pat', 'party']

/**
 * Accepted image formats, by extension, each with its magic bytes.
 *
 * `gif` and `webp` may be *animated*: they animate inside an `<img>` with no
 * descriptor and no renderer change, so they are the cheapest way to ship
 * motion. A sprite sheet is the other way, and the only way to control timing.
 */
const IMAGE_TYPES = {
	png: [0x89, 0x50, 0x4e, 0x47],
	webp: [0x52, 0x49, 0x46, 0x46],
	jpeg: [0xff, 0xd8, 0xff],
	gif: [0x47, 0x49, 0x46, 0x38],
}

/** Accepted sound formats, by extension, with a signature check where one exists. */
const SOUND_TYPES = {
	wav: [0x52, 0x49, 0x46, 0x46],
	mp3: [0x49, 0x44, 0x33],
	ogg: [0x4f, 0x67, 0x67, 0x53],
}

/** Events a pack may supply a sound for. */
export const SOUND_EVENTS = ['done', 'error', 'alert', 'pat']

export const LIMITS = {
	/** One image. Generous for a 1024px illustration, mean about a video frame. */
	imageBytes: 512 * 1024,
	/** Every file in a pack. */
	packBytes: 4 * 1024 * 1024,
	/** Longest side, in pixels. */
	imageSide: 2048,
	/** Files a pack may contain, so a pack cannot become a file dump. */
	files: 32,
	/** One sound. Cues are short by nature. */
	soundBytes: 256 * 1024,
	/** Frames in a sprite sheet. */
	frames: 60,
	/** Frames per second, upper bound. */
	fps: 24,
	/** Frame side, in pixels. */
	frameSide: 2048,
	/** Characters in an id. */
	idLength: 64,
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
/** Segments the routes already use; a pack id must not collide with them. */
const RESERVED_IDS = ['active', 'export']
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const RELATIVE_PATH = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(png|webp|jpeg|gif)$/
const AUDIO_PATH = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(wav|mp3|ogg)$/

/**
 * Why a pack was rejected, as codes rather than prose.
 *
 * The messages matter less than the codes: a UI can translate them, and a test
 * can assert on them without matching English.
 */
export const ERRORS = {
	SHEET: 'sheet-invalid',
	SHEET_GEOMETRY: 'sheet-geometry',
	SOUND: 'sound-invalid',
	SOUND_FORMAT: 'sound-format',
	SOUND_MAGIC: 'sound-magic',
	SOUND_EVENT: 'sound-event-unknown',
	SCHEMA: 'schema-unsupported',
	ID: 'id-invalid',
	NAME: 'name-missing',
	VERSION: 'version-invalid',
	POSES: 'poses-missing',
	IDLE: 'idle-pose-required',
	POSE_UNKNOWN: 'pose-unknown',
	PATH: 'path-invalid',
	PATH_TRAVERSAL: 'path-traversal',
	FORMAT: 'format-unsupported',
	MAGIC: 'magic-mismatch',
	TOO_LARGE: 'too-large',
	TOO_WIDE: 'too-wide',
	TOO_MANY_FILES: 'too-many-files',
	NO_ALPHA: 'alpha-required',
	FILE_MISSING: 'file-missing',
}

/**
 * A pack-relative path that stays inside the pack.
 *
 * Rejects absolute paths, traversal, backslashes, and anything that is not
 * `<dir>/<name>.<ext>` with a known image extension. This is the only defence
 * between a shared pack and writing outside its directory.
 *
 * @returns the path when acceptable, otherwise null.
 */
export function safePath(path) {
	if (typeof path !== 'string') return null
	if (path.length === 0 || path.length > 128) return null
	if (path.includes('\\') || path.startsWith('/') || path.includes('//')) return null
	if (path.split('/').includes('..') || path.split('/').includes('.')) return null
	if (!RELATIVE_PATH.test(path)) return null
	const stem = path.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase()
	if (WINDOWS_DEVICES.includes(stem)) return null
	return path
}

/** Device names Windows reserves regardless of extension. */
const WINDOWS_DEVICES = ['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9', 'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9']

/** A pack-relative path to a sound file, or null. */
export function safeAudioPath(path) {
	if (typeof path !== 'string') return null
	if (path.length === 0 || path.length > 128) return null
	if (path.includes('\\') || path.startsWith('/') || path.includes('//')) return null
	const segments = path.split('/')
	if (segments.includes('..') || segments.includes('.')) return null
	if (!AUDIO_PATH.test(path)) return null
	const stem = path.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase()
	if (WINDOWS_DEVICES.includes(stem)) return null
	return path
}

/** Whether sound bytes match their extension. */
export function soundMatches(path, bytes) {
	const extension = String(path).split('.').pop()
	const signature = SOUND_TYPES[extension]
	if (signature === undefined || bytes === undefined || bytes === null) return false
	// MPEG frames do not always begin with an ID3 tag; a frame sync is valid too.
	if (extension === 'mp3') {
		const tagged = bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33
		const framed = bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0
		return tagged || framed
	}
	if (bytes.length < signature.length) return false
	for (let i = 0; i < signature.length; i++) {
		if (bytes[i] !== signature[i]) return false
	}
	// WAV is RIFF....WAVE, not merely RIFF.
	if (extension === 'wav') return bytes.length >= 12 && String.fromCharCode(...bytes.slice(8, 12)) === 'WAVE'
	return true
}

/** Layouts a sheet may use. Horizontal is the default and the simplest. */
export const LAYOUTS = ['horizontal', 'vertical', 'grid']

/**
 * Columns and rows implied by a sheet's layout.
 *
 * A horizontal strip is `frames x 1`, a vertical strip `1 x frames`, a grid
 * wraps at `columns`. Derived once here so the validator and the renderer
 * cannot disagree about what a descriptor means.
 */
export function sheetGrid(sheet) {
	const frames = typeof sheet.frames === 'number' && isFinite(sheet.frames) ? Math.max(1, Math.round(sheet.frames)) : 1
	const layout = sheet.layout === undefined ? 'horizontal' : sheet.layout
	if (layout === 'vertical') return { cols: 1, rows: frames }
	if (layout === 'grid') {
		const cols = typeof sheet.columns === 'number' && isFinite(sheet.columns) ? Math.max(1, Math.round(sheet.columns)) : 1
		return { cols: Math.min(cols, frames), rows: Math.ceil(frames / Math.min(cols, frames)) }
	}
	return { cols: frames, rows: 1 }
}

/**
 * Validate one sprite sheet.
 *
 * A sheet is `{ file, frameWidth, frameHeight, frames, fps, loop }`: a strip of
 * frames laid out horizontally. Timing belongs to the pack, not the renderer,
 * which is the reason to prefer sheets over animated images when the author
 * wants control.
 *
 * @returns error codes.
 */
export function validateSheet(sheet) {
	const errors = []
	if (sheet === null || typeof sheet !== 'object' || Array.isArray(sheet)) return [ERRORS.SHEET]
	if (safePath(sheet.file) === null) errors.push(ERRORS.PATH)
	if (!Number.isInteger(sheet.frameWidth) || sheet.frameWidth < 16 || sheet.frameWidth > LIMITS.frameSide) errors.push(ERRORS.SHEET_GEOMETRY)
	if (!Number.isInteger(sheet.frameHeight) || sheet.frameHeight < 16 || sheet.frameHeight > LIMITS.frameSide) errors.push(ERRORS.SHEET_GEOMETRY)
	if (!Number.isInteger(sheet.frames) || sheet.frames < 1 || sheet.frames > LIMITS.frames) errors.push(ERRORS.SHEET_GEOMETRY)
	if (sheet.fps !== undefined && (typeof sheet.fps !== 'number' || sheet.fps <= 0 || sheet.fps > LIMITS.fps)) errors.push(ERRORS.SHEET_GEOMETRY)
	if (sheet.loop !== undefined && typeof sheet.loop !== 'boolean') errors.push(ERRORS.SHEET)
	if (sheet.layout !== undefined && !LAYOUTS.includes(sheet.layout)) errors.push(ERRORS.SHEET)
	if (sheet.layout === 'grid' && (!Number.isInteger(sheet.columns) || sheet.columns < 1 || sheet.columns > LIMITS.frames)) {
		errors.push(ERRORS.SHEET_GEOMETRY)
	}
	return [...new Set(errors)]
}

/**
 * Check a sheet against the image it points at: a strip of N frames of width W
 * must fit in the picture, and no frame may be taller than it.
 *
 * @returns error codes; empty when the geometry is coherent or unverifiable.
 */
export function checkSheetGeometry(sheet, size) {
	if (size === null || size === undefined) return []
	const errors = []
	const grid = sheetGrid(sheet)
	// A grid must fit as a rectangle of cells, not as one long strip.
	if (grid.cols * sheet.frameWidth > size.width) errors.push(ERRORS.SHEET_GEOMETRY)
	if (grid.rows * sheet.frameHeight > size.height) errors.push(ERRORS.SHEET_GEOMETRY)
	return errors
}

/** Whether the bytes begin with the signature for their extension. */
export function magicMatches(path, bytes) {
	const extension = String(path).split('.').pop()
	const signature = IMAGE_TYPES[extension]
	if (signature === undefined || bytes === undefined || bytes === null) return false
	if (bytes.length < signature.length) return false
	for (let i = 0; i < signature.length; i++) {
		if (bytes[i] !== signature[i]) return false
	}
	// WebP carries its format tag after the RIFF length.
	if (extension === 'webp') {
		return bytes.length > 11 && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
	}
	return true
}

/**
 * Image dimensions from the header alone.
 *
 * Only what we can read without a decoder: PNG's IHDR and WebP's VP8X/VP8/VP8L
 * headers. Anything else reports null, which callers treat as "cannot verify"
 * rather than "fine".
 *
 * @returns `{ width, height }` or null.
 */
export function imageSize(bytes) {
	try {
		// GIF: logical screen size, little-endian, right after the signature.
		if (magicMatches('x.gif', bytes) && bytes.length >= 10) {
			return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) }
		}
		// JPEG: walk the segments to the first start-of-frame.
		if (magicMatches('x.jpeg', bytes)) {
			let at = 2
			while (at + 9 < bytes.length) {
				if (bytes[at] !== 0xff) {
					at++
					continue
				}
				const marker = bytes[at + 1]
				const length = (bytes[at + 2] << 8) | bytes[at + 3]
				// SOF0..SOF15, except the shared-table and differential markers.
				if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
					return { height: (bytes[at + 5] << 8) | bytes[at + 6], width: (bytes[at + 7] << 8) | bytes[at + 8] }
				}
				at += 2 + length
			}
		}
		// PNG: signature, then IHDR at a fixed offset.
		if (magicMatches('x.png', bytes) && bytes.length >= 24) {
			return { width: readU32(bytes, 16), height: readU32(bytes, 20) }
		}
		if (magicMatches('x.webp', bytes) && bytes.length >= 32) {
			const chunk = String.fromCharCode(...bytes.slice(12, 16))
			if (chunk === 'VP8X') {
				const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
				const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
				return { width, height }
			}
			if (chunk === 'VP8 ') {
				return { width: readU16(bytes, 26) & 0x3fff, height: readU16(bytes, 28) & 0x3fff }
			}
			if (chunk === 'VP8L') {
				const bits = readU32(bytes, 21)
				return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
			}
		}
	} catch {
		/* fall through */
	}
	return null
}

function readU32(bytes, offset) {
	return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

function readU16(bytes, offset) {
	return bytes[offset] | (bytes[offset + 1] << 8)
}

/**
 * Validate a manifest — the `manifest` half of a pack.
 *
 * @param manifest - parsed JSON, not trusted.
 * @returns `{ ok, errors: string[], warnings: string[] }`; `errors` hold codes.
 */
export function validateManifest(manifest) {
	const errors = []
	const warnings = []
	if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
		return { ok: false, errors: [ERRORS.SCHEMA], warnings }
	}
	if (manifest.schema !== SCHEMA) errors.push(ERRORS.SCHEMA)
	if (typeof manifest.id !== 'string' || !ID_PATTERN.test(manifest.id) || RESERVED_IDS.includes(manifest.id)) errors.push(ERRORS.ID)
	if (typeof manifest.name !== 'string' || manifest.name.trim() === '' || manifest.name.length > 80) errors.push(ERRORS.NAME)
	if (manifest.version !== undefined && (typeof manifest.version !== 'string' || !VERSION_PATTERN.test(manifest.version))) {
		errors.push(ERRORS.VERSION)
	}
	const poses = manifest.poses
	if (poses === null || typeof poses !== 'object' || Array.isArray(poses)) {
		errors.push(ERRORS.POSES)
	} else {
		for (const [key, value] of Object.entries(poses)) {
			if (!POSES.includes(key)) {
				// Forward compatibility: an unknown pose is ignored for rendering,
				// still validated as a path.
				warnings.push(`${ERRORS.POSE_UNKNOWN}:${key}`)
			}
			if (safePath(value) === null) {
				errors.push(String(value).includes('..') ? ERRORS.PATH_TRAVERSAL : ERRORS.PATH)
			}
		}
		if (typeof poses.idle !== 'string') errors.push(ERRORS.IDLE)
	}
	if (manifest.anchor !== undefined && !['feet', 'center', 'head'].includes(manifest.anchor)) {
		warnings.push('anchor-unknown')
	}
	if (manifest.scale !== undefined && (typeof manifest.scale !== 'number' || manifest.scale <= 0 || manifest.scale > 4)) {
		warnings.push('scale-clamped')
	}
	if (manifest.lines !== undefined && (manifest.lines === null || typeof manifest.lines !== 'object')) {
		warnings.push('lines-ignored')
	}

	if (manifest.sheets !== undefined) {
		if (manifest.sheets === null || typeof manifest.sheets !== 'object' || Array.isArray(manifest.sheets)) {
			errors.push(ERRORS.SHEET)
		} else {
			for (const [state, sheet] of Object.entries(manifest.sheets)) {
				if (!POSES.includes(state)) warnings.push(`${ERRORS.POSE_UNKNOWN}:${state}`)
				errors.push(...validateSheet(sheet))
			}
		}
	}

	if (manifest.sounds !== undefined) {
		if (manifest.sounds === null || typeof manifest.sounds !== 'object' || Array.isArray(manifest.sounds)) {
			errors.push(ERRORS.SOUND)
		} else {
			for (const [event, file] of Object.entries(manifest.sounds)) {
				if (!SOUND_EVENTS.includes(event)) {
					warnings.push(`${ERRORS.SOUND_EVENT}:${event}`)
					continue
				}
				if (safeAudioPath(file) === null) errors.push(ERRORS.SOUND_FORMAT)
			}
		}
	}
	return { ok: errors.length === 0, errors, warnings }
}

/**
 * Validate a whole single-file pack: `{ schema, manifest, files }`.
 *
 * `files` maps pack-relative paths to base64 (no data-URI prefix), which is what
 * a shared `.dshchar` file carries. Every declared pose must have a file, every
 * file must be a real image of a known format, inside the size budget.
 *
 * @param pack - parsed JSON, not trusted.
 * @param decode - decodes base64 to bytes; injected so this stays portable.
 */
export function validatePack(pack, decode) {
	const errors = []
	const warnings = []
	if (pack === null || typeof pack !== 'object') return { ok: false, errors: [ERRORS.SCHEMA], warnings }
	if (pack.schema !== SCHEMA) return { ok: false, errors: [ERRORS.SCHEMA], warnings }
	const manifestCheck = validateManifest(pack.manifest)
	errors.push(...manifestCheck.errors)
	warnings.push(...manifestCheck.warnings)

	const files = pack.files
	if (files === null || typeof files !== 'object' || Array.isArray(files)) {
		errors.push(ERRORS.FILE_MISSING)
		return { ok: false, errors, warnings }
	}
	const paths = Object.keys(files)
	if (paths.length > LIMITS.files) errors.push(ERRORS.TOO_MANY_FILES)

	let total = 0
	for (const path of paths) {
		const isAudio = AUDIO_PATH.test(path)
		if ((isAudio ? safeAudioPath(path) : safePath(path)) === null) {
			errors.push(path.includes('..') ? ERRORS.PATH_TRAVERSAL : ERRORS.PATH)
			continue
		}
		let bytes
		try {
			bytes = decode(files[path])
		} catch {
			errors.push(ERRORS.FILE_MISSING)
			continue
		}
		if (bytes === undefined || bytes === null || bytes.length === 0) {
			errors.push(ERRORS.FILE_MISSING)
			continue
		}
		total += bytes.length
		if (bytes.length > LIMITS.imageBytes) errors.push(ERRORS.TOO_LARGE)
		if (isAudio) {
			if (bytes.length > LIMITS.soundBytes) errors.push(ERRORS.TOO_LARGE)
			if (!soundMatches(path, bytes)) errors.push(ERRORS.SOUND_MAGIC)
			continue
		}
		if (!magicMatches(path, bytes)) {
			errors.push(ERRORS.MAGIC)
			continue
		}
		const size = imageSize(bytes)
		if (size === null) errors.push(ERRORS.MAGIC)
		else if (size.width > LIMITS.imageSide || size.height > LIMITS.imageSide) errors.push(ERRORS.TOO_WIDE)
	}

	if (total > LIMITS.packBytes) errors.push(ERRORS.TOO_LARGE)

	if (pack.manifest !== null && typeof pack.manifest === 'object' && pack.manifest.poses !== null && typeof pack.manifest.poses === 'object') {
		for (const declared of Object.values(pack.manifest.poses)) {
			if (typeof declared === 'string' && files[declared] === undefined) errors.push(ERRORS.FILE_MISSING)
		}
	}
	if (pack.manifest !== null && typeof pack.manifest === 'object' && pack.manifest.sheets !== null && typeof pack.manifest.sheets === 'object') {
		for (const sheet of Object.values(pack.manifest.sheets)) {
			if (sheet === null || typeof sheet !== 'object') continue
			const declared = sheet.file
			if (typeof declared !== 'string' || files[declared] === undefined) {
				errors.push(ERRORS.FILE_MISSING)
				continue
			}
			let bytes
			try {
				bytes = decode(files[declared])
			} catch {
				errors.push(ERRORS.FILE_MISSING)
				continue
			}
			errors.push(...checkSheetGeometry(sheet, imageSize(bytes)))
		}
	}

	if (pack.manifest !== null && typeof pack.manifest === 'object' && pack.manifest.sounds !== null && typeof pack.manifest.sounds === 'object') {
		for (const declared of Object.values(pack.manifest.sounds)) {
			if (typeof declared === 'string' && files[declared] === undefined) errors.push(ERRORS.FILE_MISSING)
		}
	}

	return { ok: errors.length === 0, errors: [...new Set(errors)], warnings }
}

/**
 * Which file serves a pose, given a manifest. Falls back to idle, then to the
 * first declared pose — so a pack with only an idle still works, which is the
 * smallest useful character.
 */
export function posePath(manifest, state) {
	const poses = manifest === null || typeof manifest !== 'object' ? undefined : manifest.poses
	if (poses === null || typeof poses !== 'object') return null
	if (typeof poses[state] === 'string') return poses[state]
	if (typeof poses.idle === 'string') return poses.idle
	for (const key of POSES) if (typeof poses[key] === 'string') return poses[key]
	return null
}
