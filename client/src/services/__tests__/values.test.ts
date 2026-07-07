import { describe, expect, it } from 'vitest'
import { parseValuesMapping, SCHWARTZ_KEYS } from '../values'

function valuePayload(overrides: Partial<Record<(typeof SCHWARTZ_KEYS)[number], { score: number; rationale: string }>> = {}) {
  return {
    values: SCHWARTZ_KEYS.map((key, index) => ({
      key,
      score: overrides[key]?.score ?? index * 10,
      rationale: overrides[key]?.rationale ?? `Evidence for ${key}.`,
    })),
    dominant: ['universalism', 'benevolence', 'power'],
    least_active: ['power', 'tradition', 'security'],
  }
}

describe('parseValuesMapping', () => {
  it('parses all ten canonical values, clamps scores, and slices dominant lists', () => {
    const parsed = parseValuesMapping(JSON.stringify(valuePayload({
      self_direction: { score: 130, rationale: 'Chooses independent work.' },
      power: { score: -20, rationale: 'Rarely names status as a driver.' },
    })))

    expect(parsed?.values).toHaveLength(10)
    expect(parsed?.values.find(value => value.key === 'self_direction')?.score).toBe(100)
    expect(parsed?.values.find(value => value.key === 'power')?.score).toBe(0)
    expect(parsed?.dominant).toEqual(['universalism', 'benevolence'])
    expect(parsed?.least_active).toEqual(['power', 'tradition'])
  })

  it('returns null when a canonical value is missing', () => {
    const payload = valuePayload()
    payload.values = payload.values.filter(value => value.key !== 'tradition')

    expect(parseValuesMapping(JSON.stringify(payload))).toBeNull()
  })

  it('drops unknown keys while accepting the ten canonical values', () => {
    const payload = valuePayload()
    payload.values.push({ key: 'legacy' as any, score: 90, rationale: 'Unknown value.' })

    const parsed = parseValuesMapping(JSON.stringify(payload))

    expect(parsed?.values).toHaveLength(10)
    expect(parsed?.values.some(value => value.key === ('legacy' as any))).toBe(false)
  })

  it('parses fenced JSON with trailing commas', () => {
    const raw = [
      '```json',
      JSON.stringify(valuePayload(), null, 2).replace(/"least_active": \[/, '"least_active": [').replace(/\n}/, ',\n}'),
      '```',
    ].join('\n')

    expect(parseValuesMapping(raw)?.values.map(value => value.key)).toEqual([...SCHWARTZ_KEYS])
  })

  it('truncates rationales to 240 characters', () => {
    const long = 'x'.repeat(300)
    const parsed = parseValuesMapping(JSON.stringify(valuePayload({
      achievement: { score: 72, rationale: long },
    })))

    expect(parsed?.values.find(value => value.key === 'achievement')?.rationale).toHaveLength(240)
  })
})
