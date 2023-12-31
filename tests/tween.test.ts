/**
 * @jest-environment jsdom
 */
import { describe, test, expect } from "@jest/globals"

import * as tween from "../src/tween"
import * as chip from "../src/chip"

function makeChipContext(): chip.ChipContext {
  return { rootValue: 1 }
}

describe("Tween", () => {
  test("Linear", () => {
    let value = 0

    const tweening = new tween.Tween({
      from: 0,
      to: 100,
      duration: 1000,
      onTick: (v) => {
        value = v
      },
    })

    tweening.activate({ timeSinceLastTick: 0 }, makeChipContext())

    expect(value).toBe(0)

    tweening.tick({ timeSinceLastTick: 500 })

    expect(value).toBe(50)

    tweening.tick({ timeSinceLastTick: 500 })

    expect(value).toBe(100)
    expect(tweening.state).toBe("inactive")
  })

  test("In a sequence", () => {
    const tweening = new tween.Tween({
      from: 0,
      to: 1,
      duration: 500,
      onTick: (v) => null,
    })

    const sequence = new chip.Sequence([tweening])

    sequence.activate({ timeSinceLastTick: 0 }, makeChipContext())

    expect(tweening.state).toBe("active")

    sequence.tick({ timeSinceLastTick: 500 })

    expect(tweening.state).toBe("inactive")
  })
})
