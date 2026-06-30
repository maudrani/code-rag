import { describe, expect, it } from 'vitest'
import { ANSWER_GATES } from '../../src/answer/telemetry.js'
import { SURFACE_GATES } from '../../src/consume/gates.js'
import { INGEST_GATES } from '../../src/ingest/gates.js'
import {
  auditRegistry,
  createGateRegistry,
  type Gate,
  MEMBRANE_GATES,
  registryHasGap,
} from '../../src/registry.js'
import { RETRIEVE_GATES } from '../../src/retrieve/telemetry.js'

describe('gate registry — the anti-vacuity audit (adopts peripheral claim-gate)', () => {
  it('a backed (gateTest-referenced) gate passes; the registry has NO gap', () => {
    const reg = createGateRegistry([
      {
        id: 'g1',
        claim: 'telemetry() returns the holding snapshot',
        layer: 'membrane',
        gateTest: 'tests/membrane/telemetry.test.ts::telemetry()',
      },
    ])
    expect(reg.auditRegistry().map((v) => v.status)).toEqual(['pass'])
    expect(reg.registryHasGap()).toBe(false)
  })

  it('FAILURE TWIN: an unbacked gate (declared behavior, no gateTest) is a gap', () => {
    const gates: Gate[] = [{ id: 'g1', claim: 'replay race fix', layer: 'membrane' }]
    const reg = createGateRegistry(gates)
    expect(reg.auditRegistry()[0]?.status).toBe('unbacked')
    expect(reg.registryHasGap()).toBe(true) // non-vacuous: a declared-but-ungated claim fails CI
  })

  it('a referenced-but-not-exercised (phantom/stale) gate is a gap', () => {
    const reg = createGateRegistry([
      {
        id: 'g1',
        claim: 'x',
        layer: 'membrane',
        gateTest: 'tests/x.test.ts::x',
        exercised: false,
      },
    ])
    expect(reg.auditRegistry()[0]?.status).toBe('not-exercised')
    expect(reg.registryHasGap()).toBe(true)
  })

  it('registerGate flips a clean registry to gapped when an unbacked gate is added', () => {
    const reg = createGateRegistry([
      { id: 'ok', claim: 'x', layer: 'membrane', gateTest: 'tests/x.test.ts::x' },
    ])
    expect(reg.registryHasGap()).toBe(false)
    reg.registerGate({ id: 'bad', claim: 'y', layer: 'membrane' }) // unbacked
    expect(reg.registryHasGap()).toBe(true)
  })

  it('the membrane default registry registers its own gates and is gap-free (CI green)', () => {
    const statuses = auditRegistry().map((v) => v.status)
    expect(statuses.length).toBeGreaterThanOrEqual(2) // telemetry + replay gates
    expect(statuses.every((s) => s === 'pass')).toBe(true)
    expect(registryHasGap()).toBe(false)
  })
})

describe('default registry — every layer folded into the anti-vacuity seam', () => {
  it('includes the membrane/answer/surface/retrieve/ingest/chunk gate ids, all backed, gap-free', () => {
    const ids = auditRegistry().map((v) => v.id)
    // one representative DECLARED id per folded layer must be present in the default singleton:
    expect(ids).toContain('membrane.telemetry')
    expect(ids).toContain('answer.telemetry')
    expect(ids).toContain('surface.stats')
    expect(ids).toContain('L4.scoresByLeg')
    expect(ids).toContain('ingest.telemetry')
    expect(ids).toContain('chunk.telemetry')
    expect(auditRegistry().every((v) => v.status === 'pass')).toBe(true)
    expect(registryHasGap()).toBe(false) // every layer's gates are backed + exercised
  })

  it('FAILURE TWIN: an unbacked gate added to the folded set flips registryHasGap() true', () => {
    // the SAME fold the default registry seeds (each layer's array read from its owner):
    const folded = createGateRegistry([
      ...MEMBRANE_GATES,
      ...ANSWER_GATES,
      ...SURFACE_GATES,
      ...RETRIEVE_GATES,
      ...INGEST_GATES,
    ])
    expect(folded.registryHasGap()).toBe(false) // the real fold is gap-free
    folded.registerGate({ id: 'unbacked.bogus', claim: 'declared, never gated', layer: 'x' })
    expect(folded.registryHasGap()).toBe(true) // non-vacuous: a declared-but-ungated claim fails CI
  })
})
