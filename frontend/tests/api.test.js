import test from 'node:test'
import assert from 'node:assert/strict'
import {safeQr} from '../src/api.js'
test('accepts only a base64 QR payload',()=>{
 assert.equal(safeQr('aGVsbG8='),'aGVsbG8=')
 assert.equal(safeQr('data:image/png;base64,aGVsbG8='),'')
 assert.equal(safeQr('<img>'),'')
})
