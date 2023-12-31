import * as _ from "radash"

import * as chip from "./chip"
import * as util from "./util"

interface HMR<Data extends { reloadMemento?: chip.ReloadMemento }> {
  dispose: (cb: (data: Data) => void) => void
  accept: (cb: (dependencies: string[]) => void) => void
  data: Data
}

export class RunnerOptions<
  HMRData extends { reloadMemento?: chip.ReloadMemento }
> {
  rootContext: chip.ChipContext = {}
  inputSignal: chip.Signal = new chip.Signal()

  /** If minFps <= 0, it is ignored */
  minFps = 10

  /** Enable hot reloading by passing it `module.hot` */
  hmr?: HMR<HMRData>
}

/**
 * Manages running the game code at a regular refresh rate.
 */
export class Runner<HMRData extends { reloadMemento?: chip.ReloadMemento }> {
  private _options: RunnerOptions<HMRData>
  private _isRunning = false
  private _lastTimeStamp!: number
  private _rootContext!: chip.ChipContext
  private _rootChip!: chip.Chip

  /**
   *
   * @param _rootChipResolvable The chip at the root of the game
   * @param options
   */
  constructor(
    private readonly _rootChipResolvable: chip.ChipResolvable,
    options?: Partial<RunnerOptions<HMRData>>
  ) {
    this._options = util.fillInOptions(options, new RunnerOptions())

    this._isRunning = false
  }

  start() {
    if (this._isRunning) throw util.shortStackError("Already started")

    this._isRunning = true
    this._lastTimeStamp = 0

    this._rootContext = chip.processChipContext(this._options.rootContext, {})
    this._rootChip = _.isFunction(this._rootChipResolvable)
      ? this._rootChipResolvable(this._rootContext, new chip.Signal())!
      : this._rootChipResolvable

    if (!this._rootChip) throw util.shortStackError("Root chip is null")

    this._rootChip.once("terminated", () => (this._isRunning = false))

    const tickInfo: chip.TickInfo = {
      timeSinceLastTick: 0,
    }
    this._rootChip.activate(
      tickInfo,
      this._rootContext,
      this._options.inputSignal
    )

    requestAnimationFrame(() => this._onTick())

    if (this._options.hmr) this._enableHotReloading()
  }

  stop() {
    if (!this._isRunning) throw util.shortStackError("Already stopped")

    this._isRunning = false
    this._rootChip.terminate(new chip.Signal("stop"))
  }

  pause() {
    if (!this._isRunning) throw util.shortStackError("Already stopped")

    this._isRunning = false
  }

  resume() {
    if (this._isRunning) throw util.shortStackError("Already playing")

    this._isRunning = true
    requestAnimationFrame(() => this._onTick())
  }

  private _onTick() {
    if (!this._isRunning) return

    const timeStamp = performance.now()

    let timeSinceLastTick = timeStamp - this._lastTimeStamp
    this._lastTimeStamp = timeStamp

    // If no time elapsed, don't update
    if (timeSinceLastTick <= 0) return

    // Optionally clamp time since last frame
    if (this._options.minFps >= 0) {
      timeSinceLastTick = Math.min(
        timeSinceLastTick,
        1000 / this._options.minFps
      )
    }

    const tickInfo: chip.TickInfo = {
      timeSinceLastTick,
    }

    this._rootChip.tick(tickInfo)

    requestAnimationFrame(() => this._onTick())
  }

  private _enableHotReloading() {
    console.log("enabling hot reloading")

    this._options.hmr?.dispose((data) => {
      // module is about to be replaced.
      // You can save data that should be accessible to the new asset in `data`
      console.log("this._options.hmr.dispose() called")

      data.reloadMemento = this._rootChip.makeReloadMemento()
    })

    this._options.hmr?.accept(() => {
      // module or one of its dependencies was just updated.
      // data stored in `dispose` is available in `this._options.hmr.data`
      console.log("this._options.hmr.accept() called")

      const reloadMemento = this._options.hmr?.data?.reloadMemento
      console.log("reloading from", reloadMemento)

      const tickInfo: chip.TickInfo = {
        timeSinceLastTick: 0,
      }
      this._rootChip.terminate(new chip.Signal("beforeReload"))
      this._rootChip.activate(
        tickInfo,
        this._rootContext,
        new chip.Signal("afterReload"),
        reloadMemento
      )
    })
  }

  get isRunning(): boolean {
    return this._isRunning
  }
}
