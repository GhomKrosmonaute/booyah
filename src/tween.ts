import * as geom from "./geom"
import * as chip from "./chip"
import * as easing from "./easing"

export interface BaseTweenEvents extends chip.BaseChipBaseEvents {
  updatedValue: [value: number]
}

export interface TweenOptions {
  from: number
  to: number
  duration: number
  easing?: easing.EasingFunction
  onActivate: () => unknown
  onTick?: (value: number) => unknown
  onTerminate?: () => unknown
}

/**
 * Events:
 *  updatedValue(value)
 */
export class Tween<
  TweenEvents extends BaseTweenEvents = BaseTweenEvents
> extends chip.ChipBase<TweenEvents> {
  private _startValue!: number
  private _value!: number
  private _timePassed!: number

  private _easing: easing.EasingFunction

  constructor(public readonly options: TweenOptions) {
    super()

    if (this.options.onTick) {
      this._subscribe(this, "updatedValue", this.options.onTick)
    }

    this._easing = options.easing || easing.linear
  }

  _onActivate() {
    this._startValue = this.options.from
    this._value = this._startValue
    this._updateValue()

    this._timePassed = 0

    if (this.options.onActivate) {
      this.options.onActivate()
    }
  }

  _onTick() {
    if (this._timePassed >= this.options.duration) {
      this._outputSignal = chip.makeSignal()

      // Snap to end
      this._value = this.options.to

      this._updateValue()
    } else {
      this._timePassed += this._lastTickInfo.timeSinceLastTick

      const easedProgress = this._easing(
        this._timePassed / this.options.duration
      )

      this._value = geom.lerp(this._startValue, this.options.to, easedProgress)

      this._updateValue()
    }
  }

  _onTerminate() {
    if (this.options.onTerminate) {
      this.options.onTerminate()
    }
  }

  _updateValue() {
    this.emit("updatedValue", this._value)
  }
}
