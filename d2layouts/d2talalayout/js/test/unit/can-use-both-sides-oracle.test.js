import { expect, describe, it } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { Node } from '../../src/index.js'
import { Orientation } from '../../src/geometry/orientation.js'
import { CanUseBothSides } from '../../src/proximity/index.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const oracleFile = join(__dirname, '../fixtures/go-can-use-both-sides-reference.json')
const oracle = JSON.parse(readFileSync(oracleFile, 'utf8'))

function checkOracle(name) {
  const goRes = oracle.scenarios[name]
  expect(goRes).toBeDefined()

  if (!goRes.success) {
    expect(() => CanUseBothSides(null, Orientation.Top)).toThrow(TypeError)
    return
  }

  const node = new Node(1, goRes.width, goRes.height)
  node.Width = goRes.width
  node.Height = goRes.height

  const orientation = Orientation[goRes.orientation]
  expect(orientation).toBe(goRes.orientationInt)

  const actual = CanUseBothSides(node, orientation)
  expect(actual).toBe(goRes.result)
}

describe('CanUseBothSides Oracle Replay', () => {
  for (const scenarioName of Object.keys(oracle.scenarios).sort()) {
    it(scenarioName, () => {
      checkOracle(scenarioName)
    })
  }
})
