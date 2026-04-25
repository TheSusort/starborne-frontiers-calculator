import { describe, it, expect } from 'vitest'
import { arrayMove } from '../arrayMove'

describe('arrayMove', () => {
  it('moves item forward', () => {
    expect(arrayMove(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves item backward', () => {
    expect(arrayMove(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('returns same reference when from === to', () => {
    const input = ['a', 'b', 'c']
    expect(arrayMove(input, 1, 1)).toBe(input)
  })

  it('returns same reference when fromIndex is out of range', () => {
    const input = ['a', 'b', 'c']
    expect(arrayMove(input, -1, 1)).toBe(input)
    expect(arrayMove(input, 3, 1)).toBe(input)
  })

  it('returns same reference when toIndex is out of range', () => {
    const input = ['a', 'b', 'c']
    expect(arrayMove(input, 0, -1)).toBe(input)
    expect(arrayMove(input, 0, 3)).toBe(input)
  })

  it('does not mutate the input', () => {
    const input = ['a', 'b', 'c']
    const snapshot = [...input]
    arrayMove(input, 0, 2)
    expect(input).toEqual(snapshot)
  })
})
