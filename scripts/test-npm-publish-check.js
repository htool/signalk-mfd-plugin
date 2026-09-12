#!/usr/bin/env node
const assert = require('assert')
const check = require('./npm-publish-check.js')

assert.strictEqual(check.isPublishablePath('plugin/index.js'), true)
assert.strictEqual(check.isPublishablePath('public/index.html'), false)
assert.strictEqual(check.isPublishablePath('README.md'), false)
assert.strictEqual(check.isPublishablePath('.github/workflows/release.yml'), false)

assert.strictEqual(check.bumpPatch('0.0.10'), '0.0.11')
assert.strictEqual(check.nextPublishVersion('0.0.10', '0.0.10'), '0.0.11')
assert.strictEqual(check.nextPublishVersion('0.0.10', '0.0.11'), '0.0.12')
assert.strictEqual(check.nextPublishVersion('0.0.12', '0.0.10'), '0.0.13')

const noon = new Date('2026-09-12T12:00:00.000Z')
assert.strictEqual(
  check.alreadyPublishedToday('2026-09-12T01:00:00.000Z', noon),
  true
)
assert.strictEqual(
  check.alreadyPublishedToday('2026-09-11T23:59:59.000Z', noon),
  false
)

const skipToday = check.shouldPublish({
  now: noon,
  lastPublishTime: '2026-09-12T06:00:00.000Z',
  changedFiles: ['plugin/index.js', 'README.md']
})
assert.strictEqual(skipToday.publish, false)
assert.strictEqual(skipToday.reason, 'already published today')

const skipNoChange = check.shouldPublish({
  now: noon,
  lastPublishTime: '2026-09-11T16:00:00.000Z',
  changedFiles: ['README.md', '.github/workflows/release.yml']
})
assert.strictEqual(skipNoChange.publish, false)
assert.strictEqual(
  skipNoChange.reason,
  'no plugin or public updates since last publish'
)

const publish = check.shouldPublish({
  now: noon,
  lastPublishTime: '2026-09-10T22:48:14.000Z',
  changedFiles: ['plugin/index.js', 'README.md']
})
assert.strictEqual(publish.publish, true)
assert.deepStrictEqual(publish.files, ['plugin/index.js'])

const forced = check.shouldPublish({
  force: true,
  now: noon,
  lastPublishTime: '2026-09-12T06:00:00.000Z',
  changedFiles: []
})
assert.strictEqual(forced.publish, true)
assert.strictEqual(forced.reason, 'forced')

assert.throws(function () {
  check.decide({
    cwd: require('path').join(__dirname, '..'),
    npmView: function () {
      return '{}'
    }
  })
}, /no version/)

const fromArray = check.decide({
  cwd: require('path').join(__dirname, '..'),
  force: true,
  changedFiles: [],
  npmView: function () {
    return { version: '0.0.10', time: ['2026-09-10T22:50:10.115Z'] }
  }
})
assert.strictEqual(fromArray.lastPublishTime, '2026-09-10T22:50:10.115Z')

const fromModified = check.decide({
  cwd: require('path').join(__dirname, '..'),
  force: true,
  changedFiles: [],
  npmView: function () {
    return { version: '0.0.10', time: { modified: '2026-09-10T22:50:10.440Z' } }
  }
})
assert.strictEqual(fromModified.lastPublishTime, '2026-09-10T22:50:10.440Z')

const live = check.decide({
  cwd: require('path').join(__dirname, '..'),
  force: true,
  changedFiles: []
})
assert.strictEqual(typeof live.npmVersion, 'string')
assert.ok(live.lastPublishTime)

console.log('ok')
