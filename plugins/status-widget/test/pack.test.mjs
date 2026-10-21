/**
 * The character-pack format: what it accepts, and — more importantly — what it
 * refuses.
 *
 * A format is only a standard if someone else can implement the rules from the
 * document, so the validator lives in `src/pack.js` with no Node and no DOM, and
 * every rejection below has a test with the exact geometry that triggered it.
 */
import assert from 'node:assert/strict'
import {
	ERRORS,
	LIMITS,
	SOUND_EVENTS,
	checkSheetGeometry,
	imageSize,
	magicMatches,
	posePath,
	safeAudioPath,
	safePath,
	soundMatches,
	validateManifest,
	validatePack,
	validateSheet,
} from '../src/pack.js'

let failures = 0
let checks = 0

function test(name, fn) {
	checks++
	try {
		fn()
		console.log(`  ok   ${name}`)
	} catch (error) {
		failures++
		console.log(`  FAIL ${name}`)
		console.log(`       ${error.message.split('\n').join('\n       ')}`)
	}
}

/** A PNG header of the given size, optionally padded to a byte count. */
function png(width, height, pad = 0) {
	const bytes = new Uint8Array(33 + pad)
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
	bytes.set([0x00, 0x00, 0x00, 0x0d, 8], 8)
	bytes.set([0x49, 0x48, 0x44, 0x52], 12)
	new DataView(bytes.buffer).setUint32(16, width)
	new DataView(bytes.buffer).setUint32(20, height)
	bytes[25] = 6
	return bytes
}

const toBase64 = (bytes) => Buffer.from(bytes).toString('base64')
const decode = (value) => new Uint8Array(Buffer.from(value, 'base64'))

const manifest = (overrides = {}) => ({
	schema: 1,
	id: 'sample-cat',
	name: 'Sample Character',
	version: '1.0.0',
	poses: { idle: 'poses/idle.png', happy: 'poses/happy.png' },
	...overrides,
})

console.log('\nmanifest')

test('a minimal pack is valid', () => {
	assert.deepEqual(validateManifest(manifest()), { ok: true, errors: [], warnings: [] })
})

test('the wrong schema is refused by version, not silently accepted', () => {
	const result = validateManifest(manifest({ schema: 2 }))
	assert.equal(result.ok, false)
	assert.deepEqual(result.errors, [ERRORS.SCHEMA])
})

test('an idle pose is the one requirement', () => {
	const result = validateManifest(manifest({ poses: { happy: 'poses/happy.png' } }))
	assert.equal(result.ok, false)
	assert.ok(result.errors.includes(ERRORS.IDLE), 'a pack without idle has nothing to show when nothing is happening')
})

test('unknown poses warn instead of failing', () => {
	const result = validateManifest(manifest({ poses: { idle: 'poses/idle.png', skating: 'poses/skating.png' } }))
	assert.equal(result.ok, true, 'a newer pack must still load in an older build')
	assert.ok(result.warnings.some((warning) => warning.startsWith(ERRORS.POSE_UNKNOWN)))
})

test('ids are lowercase, bounded and path-safe', () => {
	for (const id of ['../evil', 'F16', 'has space', '', 'a'.repeat(65), '-leading']) {
		assert.equal(validateManifest(manifest({ id })).ok, false, `id ${JSON.stringify(id)} must be refused`)
	}
	assert.equal(validateManifest(manifest({ id: 'ok-1' })).ok, true)
})

console.log('\npaths')

test('traversal, absolutes and backslashes are refused', () => {
	for (const path of ['../idle.png', 'poses/../../idle.png', '/etc/passwd.png', 'poses\\idle.png', 'poses//idle.png', './idle.png']) {
		assert.equal(safePath(path), null, JSON.stringify(path))
	}
})

test('only relative image paths with known extensions pass', () => {
	assert.equal(safePath('poses/idle.png'), 'poses/idle.png')
	assert.equal(safePath('idle.webp'), 'idle.webp')
	assert.equal(safePath('idle.gif'), 'idle.gif', 'a GIF may animate itself, so it is allowed')
	for (const path of ['idle.svg', 'poses/idle', 'poses/idle.exe', 'poses/.hidden.png', 'idle.apng']) {
		assert.equal(safePath(path), null, JSON.stringify(path))
	}
	assert.equal(safePath('idle.svg'), null, 'SVG can carry script; it is not an image format here')
})

console.log('\nimage bytes')

test('a signature must match the extension', () => {
	const pngBytes = png(100, 120)
	assert.equal(magicMatches('a.png', pngBytes), true)
	assert.equal(magicMatches('a.webp', pngBytes), false)
	assert.equal(magicMatches('a.jpeg', pngBytes), false)
	assert.equal(magicMatches('a.png', new Uint8Array([1, 2, 3])), false)
})

test('dimensions come from the header, and a truncated file reports nothing', () => {
	assert.deepEqual(imageSize(png(1024, 512)), { width: 1024, height: 512 })
	assert.equal(imageSize(new Uint8Array([0x89, 0x50])), null)
	assert.equal(imageSize(null), null)
})

console.log('\nwhole pack')

test('a valid pack decodes and validates', () => {
	const pack = {
		schema: 1,
		manifest: manifest(),
		files: { 'poses/idle.png': toBase64(png(400, 512)), 'poses/happy.png': toBase64(png(400, 512)) },
	}
	assert.deepEqual(validatePack(pack, decode), { ok: true, errors: [], warnings: [] })
})

test('a declared pose with no file is refused', () => {
	const pack = { schema: 1, manifest: manifest(), files: { 'poses/idle.png': toBase64(png(400, 512)) } }
	const result = validatePack(pack, decode)
	assert.equal(result.ok, false)
	assert.ok(result.errors.includes(ERRORS.FILE_MISSING))
})

test('a file whose bytes do not match its name is refused', () => {
	const pack = {
		schema: 1,
		manifest: manifest(),
		files: { 'poses/idle.png': toBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), 'poses/happy.png': toBase64(png(400, 512)) },
	}
	assert.ok(validatePack(pack, decode).errors.includes(ERRORS.MAGIC))
})

test('oversized images and oversized packs are refused', () => {
	const big = { schema: 1, manifest: manifest(), files: { 'poses/idle.png': toBase64(png(400, 512, LIMITS.imageBytes)), 'poses/happy.png': toBase64(png(400, 512)) } }
	assert.ok(validatePack(big, decode).errors.includes(ERRORS.TOO_LARGE))

	const wide = { schema: 1, manifest: manifest(), files: { 'poses/idle.png': toBase64(png(LIMITS.imageSide + 1, 512)), 'poses/happy.png': toBase64(png(400, 512)) } }
	assert.ok(validatePack(wide, decode).errors.includes(ERRORS.TOO_WIDE))
})

test('a pack of too many files is refused', () => {
	const files = { 'poses/idle.png': toBase64(png(10, 10)) }
	for (let i = 0; i < LIMITS.files + 1; i++) files[`poses/extra-${i}.png`] = toBase64(png(10, 10))
	const result = validatePack({ schema: 1, manifest: manifest(), files }, decode)
	assert.ok(result.errors.includes(ERRORS.TOO_MANY_FILES) || result.errors.includes(ERRORS.TOO_LARGE))
})

test('a traversal path in files is refused before any file is read', () => {
	const pack = { schema: 1, manifest: manifest(), files: { '../evil.png': toBase64(png(10, 10)), 'poses/idle.png': toBase64(png(10, 10)) } }
	assert.ok(validatePack(pack, decode).errors.includes(ERRORS.PATH_TRAVERSAL))
})

console.log('\nsprite sheets')

const sheet = (overrides = {}) => ({ file: 'sheets/idle.png', frameWidth: 200, frameHeight: 300, frames: 6, fps: 8, loop: true, ...overrides })

test('a well-formed sheet is accepted', () => {
	assert.deepEqual(validateSheet(sheet()), [])
})

test('a sheet that cannot fit its own strip is refused', () => {
	const strip = png(1200, 300)
	assert.deepEqual(checkSheetGeometry(sheet(), imageSize(strip)), [], 'six 200px frames fit in 1200px')
	const tooNarrow = png(1000, 300)
	assert.ok(checkSheetGeometry(sheet(), imageSize(tooNarrow)).includes(ERRORS.SHEET_GEOMETRY))
	const tooShort = png(1200, 200)
	assert.ok(checkSheetGeometry(sheet({ frameHeight: 300 }), imageSize(tooShort)).includes(ERRORS.SHEET_GEOMETRY))
})

test('frame count, speed and size are bounded', () => {
	assert.ok(validateSheet(sheet({ frames: 0 })).includes(ERRORS.SHEET_GEOMETRY))
	assert.ok(validateSheet(sheet({ frames: LIMITS.frames + 1 })).includes(ERRORS.SHEET_GEOMETRY))
	assert.ok(validateSheet(sheet({ fps: 0 })).includes(ERRORS.SHEET_GEOMETRY))
	assert.ok(validateSheet(sheet({ fps: LIMITS.fps + 1 })).includes(ERRORS.SHEET_GEOMETRY))
	assert.ok(validateSheet(sheet({ frameWidth: 4 })).includes(ERRORS.SHEET_GEOMETRY))
	assert.ok(validateSheet(sheet({ loop: 'yes' })).includes(ERRORS.SHEET))
	assert.ok(validateSheet(null).includes(ERRORS.SHEET))
})

test('a sheet for an unknown state warns rather than fails', () => {
	const result = validateManifest(manifest({ sheets: { skating: sheet() } }))
	assert.equal(result.ok, true)
	assert.ok(result.warnings.some((warning) => warning.includes('skating')))
})

console.log('\nsounds')

const wav = (pad = 0) => {
	const bytes = new Uint8Array(44 + pad)
	bytes.set([0x52, 0x49, 0x46, 0x46], 0) // RIFF
	const view = new DataView(bytes.buffer)
	view.setUint32(4, 36 + pad, true)
	bytes.set([0x57, 0x41, 0x56, 0x45], 8) // WAVE
	return bytes
}

test('a wav must actually be RIFF/WAVE', () => {
	assert.equal(soundMatches('a.wav', wav()), true)
	const notWav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20])
	assert.equal(soundMatches('a.wav', notWav), false, 'RIFF alone is not a WAV')
})

test('mp3 accepts an ID3 tag or a bare frame sync', () => {
	const id3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0])
	assert.equal(soundMatches('a.mp3', id3), true)
	const frame = new Uint8Array([0xff, 0xfb, 0x90, 0x00])
	assert.equal(soundMatches('a.mp3', frame), true)
	assert.equal(soundMatches('a.mp3', new Uint8Array([0, 0, 0, 0])), false)
})

test('sound paths and formats are constrained', () => {
	assert.equal(safeAudioPath('sounds/done.wav'), 'sounds/done.wav')
	for (const path of ['../done.wav', '/done.wav', 'sounds\\done.wav', 'done.png', 'done.exe']) {
		assert.equal(safeAudioPath(path), null, JSON.stringify(path))
	}
})

test('unknown sound events warn, known ones must be sound files', () => {
	const ok = validateManifest(manifest({ sounds: { done: 'sounds/done.wav' } }))
	assert.equal(ok.ok, true)
	const unknown = validateManifest(manifest({ sounds: { explode: 'sounds/x.wav' } }))
	assert.equal(unknown.ok, true, 'an unknown event is forward compatibility')
	assert.ok(unknown.warnings.some((warning) => warning.includes('explode')))
	const wrongFormat = validateManifest(manifest({ sounds: { done: 'sounds/done.png' } }))
	assert.equal(wrongFormat.ok, false)
	assert.ok(wrongFormat.errors.includes(ERRORS.SOUND_FORMAT))
})

test('every declared event is a real one', () => {
	assert.deepEqual(SOUND_EVENTS, ['done', 'error', 'alert', 'pat'])
})

test('a pack with a sheet and a sound validates end to end', () => {
	const pack = {
		schema: 1,
		manifest: manifest({ sheets: { idle: sheet() }, sounds: { done: 'sounds/done.wav' } }),
		files: {
			'poses/idle.png': toBase64(png(400, 512)),
			'poses/happy.png': toBase64(png(400, 512)),
			'sheets/idle.png': toBase64(png(1200, 300)),
			'sounds/done.wav': toBase64(wav()),
		},
	}
	assert.deepEqual(validatePack(pack, decode), { ok: true, errors: [], warnings: [] })
})

test('a sheet pointing at a missing file is refused', () => {
	const pack = {
		schema: 1,
		manifest: manifest({ sheets: { idle: sheet() } }),
		files: { 'poses/idle.png': toBase64(png(400, 512)), 'poses/happy.png': toBase64(png(400, 512)) },
	}
	assert.ok(validatePack(pack, decode).errors.includes(ERRORS.FILE_MISSING))
})

test('a sound that is not really audio is refused', () => {
	const pack = {
		schema: 1,
		manifest: manifest({ sounds: { done: 'sounds/done.wav' } }),
		files: {
			'poses/idle.png': toBase64(png(400, 512)),
			'poses/happy.png': toBase64(png(400, 512)),
			'sounds/done.wav': toBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])),
		},
	}
	assert.ok(validatePack(pack, decode).errors.includes(ERRORS.SOUND_MAGIC))
})

console.log('\nsecurity')

test('the container schema is checked, not just the manifest', () => {
	const pack = { schema: 2, manifest: { schema: 1, id: 'x', name: 'X', poses: { idle: 'a.png' } }, files: { 'a.png': toBase64(png(10, 10)) } }
	assert.deepEqual(validatePack(pack, decode).errors, [ERRORS.SCHEMA])
})

test('route words cannot be used as pack ids', () => {
	for (const id of ['active', 'export']) {
		assert.equal(validateManifest(manifest({ id })).ok, false, `id ${id} collides with a route`)
	}
})

test('Windows device names are refused for images and sounds alike', () => {
	for (const path of ['con.png', 'NUL.png', 'aux.webp', 'com1.jpeg']) assert.equal(safePath(path), null, path)
	for (const path of ['con.wav', 'NUL.mp3', 'aux.ogg']) assert.equal(safeAudioPath(path), null, path)
	assert.equal(safePath('console.png'), 'console.png', 'only exact stems are reserved')
})

test('an unknown pose name is still validated as a path', () => {
	const result = validateManifest(manifest({ poses: { idle: 'poses/idle.png', constructor: '../../../secret.txt' } }))
	assert.equal(result.ok, false, 'unknown keys cannot smuggle traversal')
	assert.ok(result.errors.includes(ERRORS.PATH_TRAVERSAL))
})

test('a GIF is measured, so the size limit cannot be dodged by format', () => {
	const huge = new Uint8Array(64)
	huge.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0xff, 0xff, 0xff, 0xff], 0)
	assert.deepEqual(imageSize(huge), { width: 65535, height: 65535 })
	const pack = { schema: 1, manifest: manifest({ poses: { idle: 'a.gif' } }), files: { 'a.gif': toBase64(huge) } }
	assert.ok(validatePack(pack, decode).errors.includes(ERRORS.TOO_WIDE))
})

console.log('\npose resolution')

test('a missing state falls back to idle, then to any pose', () => {
	const m = manifest()
	assert.equal(posePath(m, 'happy'), 'poses/happy.png')
	assert.equal(posePath(m, 'busy'), 'poses/idle.png', 'an unknown state uses idle, not nothing')
	assert.equal(posePath({ poses: { worried: 'poses/worried.png' } }, 'busy'), 'poses/worried.png')
	assert.equal(posePath({ poses: {} }, 'busy'), null)
	assert.equal(posePath(null, 'busy'), null)
})

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
