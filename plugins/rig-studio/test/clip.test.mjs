import assert from 'node:assert/strict'
import { test, report } from './harness.mjs'
import { cuesBetween, ease, loopSeam, sampleClip, sampleTrack } from '../src/rig/clip.js'

const track = (keys) => ({ boneId: 0, property: 'rotation', keys })

console.log('\nsampling')

test('linear interpolates between keys', () => {
	assert.equal(sampleTrack(track([{ t: 0, v: 0 }, { t: 100, v: 10, }]), 50), 5)
})

test('smooth eases in and out, and still hits both ends', () => {
	assert.equal(ease('smooth', 0), 0)
	assert.equal(ease('smooth', 1), 1)
	assert.equal(ease('smooth', 0.5), 0.5)
	assert.ok(ease('smooth', 0.25) < 0.25, 'it starts slowly')
	assert.ok(ease('smooth', 0.75) > 0.75, 'and finishes late')
})

test('step holds until the next key', () => {
	const stepped = track([{ t: 0, v: 0, ease: 'step' }, { t: 100, v: 10 }])
	assert.equal(sampleTrack(stepped, 99), 0)
	assert.equal(sampleTrack(stepped, 100), 10)
})

test('a cubic bezier is monotonic and pinned at the ends', () => {
	const keyed = track([{ t: 0, v: 0, ease: [0.42, 0, 0.58, 1] }, { t: 100, v: 10 }])
	assert.equal(sampleTrack(keyed, 0), 0)
	assert.equal(sampleTrack(keyed, 100), 10)
	const mid = sampleTrack(keyed, 50)
	assert.ok(mid > 0 && mid < 10)
})

test('before the first key and after the last hold their values', () => {
	const keyed = track([{ t: 100, v: 5 }, { t: 200, v: 9 }])
	assert.equal(sampleTrack(keyed, 0), 5)
	assert.equal(sampleTrack(keyed, 900), 9)
})

test('a single key is a constant', () => {
	assert.equal(sampleTrack(track([{ t: 50, v: 7 }]), 0), 7)
})

console.log('\nclips')

test('a looping clip wraps on its duration', () => {
	const clip = { duration: 1000, loop: true, tracks: [track([{ t: 0, v: 0 }, { t: 1000, v: 10 }])] }
	assert.equal(sampleClip(clip, 0)[0].rotation, 0)
	assert.equal(sampleClip(clip, 1000)[0].rotation, 0, 'the duration is the first frame again')
	assert.equal(sampleClip(clip, 1500)[0].rotation, 5)
	assert.equal(sampleClip(clip, -250)[0].rotation, 7.5, 'negative time wraps too')
})

test('a one-shot clip clamps at its ends', () => {
	const clip = { duration: 500, loop: false, tracks: [track([{ t: 0, v: 0 }, { t: 500, v: 10 }])] }
	assert.equal(sampleClip(clip, -100)[0].rotation, 0)
	assert.equal(sampleClip(clip, 900)[0].rotation, 10)
})

test('only the properties a clip touches appear', () => {
	const clip = { duration: 100, loop: false, tracks: [{ boneId: 3, property: 'x', keys: [{ t: 0, v: 1 }] }] }
	assert.deepEqual(sampleClip(clip, 0), { 3: { x: 1 } })
})

console.log('\ncues')

test('markers fire every pass, events fire once', () => {
	const clip = {
		duration: 1000,
		loop: true,
		tracks: [],
		markers: [{ t: 500, name: 'footfall' }],
		events: [{ t: 900, name: 'thud' }],
	}
	// Two passes in one long step: the marker twice, the event twice as well
	// (it is a one-shot *within* each pass, not once per lifetime).
	const long = cuesBetween(clip, 0, 2000)
	assert.equal(long.markers.length, 2)
	assert.equal(long.events.length, 2)

	const first = cuesBetween(clip, 0, 600)
	assert.deepEqual(first.markers.map((cue) => cue.name), ['footfall'])
	assert.equal(first.events.length, 0, 'the event has not happened yet')

	const many = []
	for (let t = 0; t < 2000; t += 16) many.push(...cuesBetween(clip, t, t + 16).markers)
	assert.equal(many.length, 2, 'many small steps agree with one long step')
})

console.log('\nloop seam')

test('a clip that returns to its start has no seam', () => {
	const clip = { loop: true, tracks: [track([{ t: 0, v: 0 }, { t: 1000, v: 4 }, { t: 2000, v: 0 }])] }
	assert.equal(loopSeam(clip), 0)
})

test('a clip that ends elsewhere reports the gap', () => {
	const clip = { loop: true, tracks: [track([{ t: 0, v: 0 }, { t: 1000, v: 8 }])] }
	assert.equal(loopSeam(clip), 8)
})

test('a one-shot clip has no seam to speak of', () => {
	assert.equal(loopSeam({ loop: false, tracks: [track([{ t: 0, v: 0 }, { t: 1000, v: 8 }])] }), 0)
})

report()
