import { EventEmitter, BaseEventNames } from "@ghom/event-emitter"
import * as _ from "radash"
import * as util from "./util"
import * as event from "./event"

/**
 * A `Signal` represents a immutable message that is provided to a chip when it activates,
 * as well as when it terminates.
 * A signal has a `name` and an optional map of strings to data.
 */
export class Signal<SignalName extends string = string> {
  public constructor(
    private readonly _name?: SignalName,
    public readonly params: any = {}
  ) {
    // @ts-ignore
    if (!_name) this._name = "default"
  }

  public get name(): SignalName {
    return this._name!
  }
}

export function isSignal(e: unknown): e is Signal<any> {
  return e instanceof Signal
}

/**
 * A ChipContext is a immutable map of strings to data.
 * It is provided to chips by their parents.
 *
 * Instead of modifying a chip context, it should be overloaded,
 * by calling `processChipContext90`
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ChipContext = Readonly<Record<string, any>>

export type ChipContextFactory = (context: ChipContext) => ChipContext
export type ChipContextResolvable = ChipContext | ChipContextFactory

/**
 * Create a new `ChipContext` from a previous context and a list of alterations.
 * Each alteration can be a new map of strings to data, which overload previous keys,
 * or a function that takes the old context and returns a new one.
 */
export function processChipContext(
  chipContext: ChipContext,
  ...alteredContexts: Array<ChipContextResolvable | undefined>
): ChipContext {
  let context = chipContext
  for (const alteredContext of alteredContexts) {
    if (!alteredContext) continue

    if (typeof alteredContext == "function") context = alteredContext(context)
    else context = Object.assign({}, context, alteredContext)
  }

  return context
}

/**
 * Information provided to a chip on each tick
 */
export interface TickInfo {
  timeSinceLastTick: number
}

/**
 * A function that takes a context and a signal to optionally produce a new `Chip`.
 */
export type ChipFactory = (
  context: ChipContext,
  signal: Signal
) => Chip | undefined

export type ChipResolvable = Chip | ChipFactory

export function resolveChip(
  resolvable: ChipResolvable,
  context: Record<string, any>
): Chip | undefined {
  if (isChip(resolvable)) return resolvable
  else return resolvable(context, new Signal())
}

export interface ChipActivationInfo extends ActivateChildChipOptions {
  readonly chip: ChipResolvable
}

export type ChipState = "inactive" | "active" | "paused"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isChip(e: any): e is Chip {
  return (
    typeof e.activate === "function" &&
    typeof e.tick === "function" &&
    typeof e.terminate === "function"
  )
}

export function isChipResolvable(
  e: ChipResolvable | ChipActivationInfo
): e is ChipResolvable {
  return typeof e === "function" || isChip(e)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReloadMementoData = Record<string, any>

export interface ReloadMemento {
  className: string
  data?: ReloadMementoData
  children: Record<string, ReloadMemento>
}

/**
 * In Booyah, the game is structured as a tree of chips. This is the interface for all chips.
 * When creating a new chip, you most likely want to extend ChipBase or Composite,
 * which implement this interface and do the busywork for you.
 *
 * Events:
 * - activated()
 * - terminated()
 **/
export interface Chip extends event.NodeEventSource {
  /** Current state of the chip */
  readonly state: ChipState

  /** Once the chip is terminated, contains the signal */
  readonly outputSignal?: Signal

  /** Children of this chip, if any */
  readonly children: Record<string, Chip>

  /** Activate the chip, with a provided context and input signal.
   * Should only be called from an inactive state
   * */
  activate(
    tickInfo: TickInfo,
    chipContext: ChipContext,
    inputSignal: Signal,
    reloadMemento?: ReloadMemento
  ): void

  /** Update the chip, provided a new time */
  tick(tickInfo: TickInfo): void

  /** Terminate the chip. Should only be called from an active or paused state */
  terminate(outputSignal?: Signal): void

  /** Pause the chip, informing it that it won't receive ticks for a while */
  pause(): void

  /** Resumes the chip after it was paused */
  resume(): void

  makeReloadMemento(): ReloadMemento
}

export interface BaseChipBaseEvents extends BaseEventNames {
  activated: [inputSignal?: Signal]
  terminated: [outputSignal: Signal]
  resized: [width: number, height: number]
}

/**
 * A base class for creating chips that reduces boilerplate code.
 * To use it, simply override some or all of the following protected methods:
 * - _onActivate()
 * - _onTick()
 * - _onTerminate()
 * - _onPause()
 * - _onResume()
 * In these methods, you can access the `_chipContext` `_lastTickInfo` properties to obtain
 * the latest information there.
 *
 * In addition, you can subscribe to events using `_subscribe()` in a way that automatically
 * unsubscribes when the chip is terminated.
 */
export abstract class ChipBase<
    ChipBaseEvents extends BaseChipBaseEvents = BaseChipBaseEvents
  >
  extends EventEmitter<ChipBaseEvents>
  implements Chip
{
  protected _chipContext!: ChipContext
  protected _lastTickInfo!: TickInfo
  protected _inputSignal?: Signal
  protected _reloadMemento?: ReloadMemento
  protected _eventListeners: event.IEventListener[] = []
  protected _outputSignal?: Signal
  protected _state: ChipState = "inactive"

  get chipContext(): ChipContext {
    return this._chipContext
  }

  public activate(
    tickInfo: TickInfo,
    chipContext: ChipContext,
    inputSignal?: Signal,
    reloadMemento?: ReloadMemento
  ): void {
    if (this._state !== "inactive")
      throw util.shortStackError(`activate() called from state ${this._state}`)

    this._chipContext = chipContext
    this._lastTickInfo = tickInfo
    this._inputSignal = inputSignal
    this._state = "active"
    delete this._outputSignal

    if (reloadMemento && reloadMemento.className === this.constructor.name)
      this._reloadMemento = reloadMemento
    else delete this._reloadMemento

    this._onActivate()

    this._subscribe(window, "resize", () => this.resize())

    this.resize()

    this.emit("activated", inputSignal)
  }

  public tick(tickInfo: TickInfo): void {
    if (this._state === "paused") return
    if (this._state !== "active")
      throw util.shortStackError(`tick() called from state ${this._state}`)

    this._lastTickInfo = tickInfo
    this._onTick()
  }

  public resize() {
    const size: [number, number] = [
      document.documentElement.clientWidth,
      document.documentElement.clientHeight,
    ]

    this._onResize(...size)

    this.emit("resized", ...size)
  }

  public terminate(outputSignal: Signal = new Signal()): void {
    if (this._state !== "active" && this._state !== "paused")
      throw util.shortStackError(`terminate() called from state ${this._state}`)

    this._outputSignal = outputSignal
    this._onTerminate()

    this._unsubscribe() // Remove all event listeners

    this._state = "inactive"

    this.emit("terminated", this._outputSignal)
  }

  public pause(): void {
    if (this._state !== "active")
      throw util.shortStackError(`pause() called from state ${this._state}`)

    this._state = "paused"

    this._onPause()
  }

  public resume(): void {
    if (this._state !== "paused")
      throw util.shortStackError(`resume() called from state ${this._state}`)

    this._state = "active"

    this._onResume()
  }

  /**
   * Start listening to events of a certain type emitted by an object.
   * The callback will be called with the chip as `this`.
   * Works by default for both NodeJS- and DOM-style events.
   * If you are interfacing with a different event system, you can provide a
   * `subscriptionHandler` that knows how to handle it.
   */
  protected _subscribe<
    Emitter extends object,
    EventNames extends Emitter extends ChipBase<infer _EventNames>
      ? _EventNames
      : BaseEventNames,
    EventName extends keyof EventNames & string
  >(
    emitter: Emitter,
    eventName: EventName,
    cb: (this: this, ...args: EventNames[EventName]) => void,
    subscriptionHandler?: event.SubscriptionHandler
  ): void {
    if (!subscriptionHandler) {
      if (event.isNodeEventSource(emitter)) {
        subscriptionHandler = new event.NodeEventSourceSubscriptionHandler()
      } else if (event.isEventTarget(emitter)) {
        subscriptionHandler = new event.EventTargetSubscriptionHandler()
      } else {
        throw util.shortStackError(
          `Emitter is of unknown type "${typeof emitter}", requires custom SubscriptionHandler`
        )
      }
    }

    // Make sure the callback uses the correct `this`
    // @ts-ignore
    cb = cb.bind(this)

    this._eventListeners.push({
      emitter,
      event: eventName,
      cb,
      subscriptionHandler,
    })
    subscriptionHandler.subscribe(emitter, eventName, cb)
  }

  /**
   * Listen to a single event emitted by an object, then stop.
   * The callback will be called with the chip as `this`.
   * Works by default for both NodeJS- and DOM-style events.
   * If you are interfacing with a different event system, you can provide a
   * `subscriptionHandler` that knows how to handle them.
   */
  protected _subscribeOnce<
    Emitter extends object,
    EventNames extends Emitter extends ChipBase<infer _EventNames>
      ? _EventNames
      : BaseEventNames,
    EventName extends keyof EventNames & string
  >(
    emitter: Emitter,
    eventName: EventName,
    cb: (this: this, ...args: EventNames[EventName]) => void,
    subscriptionHandler?: event.SubscriptionHandler
  ): void {
    if (!subscriptionHandler) {
      if (event.isNodeEventSource(emitter)) {
        subscriptionHandler = new event.NodeEventSourceSubscriptionHandler()
      } else if (event.isEventTarget(emitter)) {
        subscriptionHandler = new event.EventTargetSubscriptionHandler()
      } else {
        throw util.shortStackError(
          `Emitter is of unknown type "${typeof emitter}", requires custom SubscriptionHandler`
        )
      }
    }

    cb = cb.bind(this)

    this._eventListeners.push({
      emitter,
      event: eventName,
      cb,
      subscriptionHandler,
    })
    subscriptionHandler.subscribeOnce(emitter, eventName, cb)
  }

  /** Unsubscribe to a set of events.
   * By default, unsubscribes to everything. If `emitter`, `event`, or `cb` is provided,
   * unsubscribe only to those.
   */
  protected _unsubscribe(
    emitter?: event.NodeEventSource,
    event?: string,
    cb?: (...args: unknown[]) => void
  ): void {
    const [listenersToRemove, listenersToKeep] = _.fork(
      this._eventListeners,
      (listener) => {
        // true if the listener should be kept
        // false if the listener should be removed
        return (
          (!emitter || emitter !== listener.emitter) &&
          (!event || event !== listener.event) &&
          (!cb || cb !== listener.cb)
        )
      }
    )
    for (const listener of listenersToRemove)
      listener.subscriptionHandler.unsubscribe(
        listener.emitter,
        listener.event,
        listener.cb
      )

    this._eventListeners = listenersToKeep
  }

  public get children(): Record<string, Chip> {
    return {}
  }

  public get outputSignal(): Signal | undefined {
    return this._outputSignal
  }

  public get state(): ChipState {
    return this._state
  }

  public makeReloadMemento(): ReloadMemento {
    if (this._state !== "active" && this._state !== "paused")
      throw util.shortStackError(
        `makeReloadMemento() called from state ${this._state}`
      )

    const childMementos: Record<string, ReloadMemento> = {}
    for (const childId in this.children) {
      childMementos[childId] = this.children[childId].makeReloadMemento()
    }

    return {
      className: this.constructor.name,
      data: this._makeReloadMementoData(),
      children: childMementos,
    }
  }

  /**
   * Template method called by `activate()`.
   */
  protected _onActivate() {
    /* no op */
  }

  /**
   * Template method called by `tick()`.
   */
  protected _onTick() {
    /* no op */
  }

  /**
   * Template method called by `resize()`
   */
  protected _onResize(width: number, height: number) {
    /* no op */
  }

  /**
   * Template method called by `terminate()`.
   */
  protected _onTerminate() {
    /* no op */
  }

  /**
   * Template method called by `pause()`.
   */
  protected _onPause() {
    /* no op */
  }

  /**
   * Template method called by `resume()`.
   */
  protected _onResume() {
    /* no op */
  }

  /** By default, a chip be automatically reloaded */
  protected _makeReloadMementoData(): ReloadMementoData | undefined {
    return undefined
  }
}

/** Empty chip that does nothing and never terminates  */
export class Forever<
  ForeverEvents extends BaseChipBaseEvents = BaseChipBaseEvents
> extends ChipBase<ForeverEvents> {}

/** An chip that terminates with a given output signal immediately  */
export class Transitory<
  TransitoryEvents extends BaseChipBaseEvents = BaseChipBaseEvents
> extends ChipBase<TransitoryEvents> {
  constructor(public readonly terminateSignal = new Signal()) {
    super()
  }

  _onActivate() {
    this.terminate(this.terminateSignal)
  }
}

export interface BaseCompositeEvents extends BaseChipBaseEvents {
  beforeActivatedChildChip: [chip: Chip, context: ChipContext, signal: Signal]
  activatedChildChip: [chip: Chip, context: ChipContext, signal: Signal]
  terminatedChildChip: [chip: Chip]
}

/** Options that can be passed to Composite._activateChildChip() */
export class ActivateChildChipOptions {
  /** Additional context or function to return a context */
  context?: ChipContextResolvable

  /** An input signal given to the chip */
  inputSignal?: Signal

  /**
   * If provided, will store the chip using this attribute name.
   * If the name ends with `[]` or if the attribute is an array,
   * adds the chip to the array attribute of that name.
   */
  attribute?: string

  /**
   * If true, adds the child chip to the context provided to children, using the
   * provided `attribute` or `id`.
   */
  includeInChildContext?: boolean

  id?: string
  reloadMemento?: ReloadMemento
}

/**
 * Base class for chips that contain other chips
 *
 * Events:
 * - beforeActivatedChildChip(chip: Chip, context: ChipContext, signal: Signal)
 * - activatedChildChip(chip: Chip, context: ChipContext, signal: Signal)
 * - terminatedChildChip(chip: Chip)
 */
export abstract class Composite<
  CompositeEvents extends BaseCompositeEvents = BaseCompositeEvents
> extends ChipBase<CompositeEvents> {
  private _childChipContext!: Record<string, unknown>
  private _deferredOutputSignal!: Signal
  // Are the activate() or tick() methods currently being run?
  private _methodCallInProgress!: boolean
  private _isReady!: boolean

  protected _childChips!: Record<string, Chip>
  protected _preparation?: ChipResolvable

  get isReady(): boolean {
    return (
      this._isReady &&
      Object.values(this._childChips).every(
        (child) => !(child instanceof Composite) || child.isReady
      )
    )
  }

  public activate(
    tickInfo: TickInfo,
    chipContext: ChipContext,
    inputSignal?: Signal,
    reloadMemento?: ReloadMemento
  ): void {
    this._childChips = {}
    this._childChipContext = {}

    this._methodCallInProgress = true
    super.activate(tickInfo, chipContext, inputSignal, reloadMemento)
    this._methodCallInProgress = false

    this._isReady = this._preparation === undefined

    if (this._preparation) {
      this._activateChildChip(
        new Sequence([
          this._preparation,
          new Lambda(() => {
            this._isReady = true
          }),
        ])
      )
    }
  }

  /**
   * By default, updates all child chips and remove those that have a signal
   * Overload this method in subclasses to change the behavior
   */
  public tick(tickInfo: TickInfo): void {
    if (this._state === "paused") return
    if (this._state !== "active")
      throw util.shortStackError(`tick() called from state ${this._state}`)

    if (this._deferredOutputSignal) {
      this.terminate(this._deferredOutputSignal)
      return
    }

    this._lastTickInfo = tickInfo

    this._onTick()
    this._methodCallInProgress = true
    this._tickChildChips()
    this._methodCallInProgress = false
    this._onAfterTick()
  }

  public terminate(outputSignal: Signal = new Signal()): void {
    // Can't just call super.terminate() here, the order is slightly different

    if (this._state !== "active" && this._state !== "paused")
      throw util.shortStackError(`terminate() called from state ${this._state}`)

    if (this._methodCallInProgress) {
      this._deferredOutputSignal = outputSignal
      return
    }

    this._state = "inactive"
    this._isReady = false

    this._unsubscribe() // Remove all event listeners

    this._terminateAllChildChips()

    this._outputSignal = outputSignal
    this._onTerminate()

    this.emit("terminated", this._outputSignal)
  }

  public pause(): void {
    super.pause()

    this._removeTerminatedChildChips()
    for (const child of Object.values(this._childChips)) {
      child.pause()
    }
  }

  public resume(): void {
    super.resume()

    this._removeTerminatedChildChips()
    for (const child of Object.values(this._childChips)) {
      child.resume()
    }
  }

  public get children(): Record<string, Chip> {
    return this._childChips
  }

  /**
   * Activate a child chip
   * @param chipResolvable A chip or function to create a chip
   * @param options
   * @returns The activated chip
   */
  protected _activateChildChip(
    chipResolvable: ChipResolvable,
    options?: Partial<ActivateChildChipOptions>
  ): Chip {
    if (this.state === "inactive")
      throw util.shortStackError("Composite is inactive")

    options = util.fillInOptions(options, new ActivateChildChipOptions())

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const thisAsAny = this as any

    // If an existing chip with that attribute exists, terminate it
    // Doesn't remove arrays, though
    if (
      options.attribute &&
      !options.attribute.endsWith("[]") &&
      thisAsAny[options.attribute]
    ) {
      if (!isChip(thisAsAny[options.attribute]))
        throw util.shortStackError(
          `Setting the attribute ${
            options.attribute
          } would replace a non-chip. Current attribute value = ${
            thisAsAny[options.attribute]
          }`
        )

      this._terminateChildChip(thisAsAny[options.attribute] as Chip)
    }

    let providedId = options.id ?? options.attribute
    if (providedId) {
      if (providedId.endsWith("[]")) {
        providedId = util.uniqueId(providedId)
      }
      if (providedId in this._childChips)
        throw util.shortStackError("Duplicate child chip ID provided")
    }

    const inputSignal = options.inputSignal ?? new Signal()

    const childContext = processChipContext(
      this._chipContext,
      this._childChipContext,
      this.defaultChildChipContext,
      options.context
    )

    let chip = resolveChip(chipResolvable, childContext)

    // If no chip is returned, then nothing more to do
    if (!chip) throw util.shortStackError("No chip returned")

    // Look for reload memento, if an id is provided
    let reloadMemento: ReloadMemento | undefined
    if (providedId && this._reloadMemento?.children[providedId]) {
      reloadMemento = this._reloadMemento.children[providedId]
    }

    // If no childId is provided, use a random temporary value
    const childId =
      providedId ?? `unknown_${Number.MAX_SAFE_INTEGER * Math.random()}`
    this._childChips[childId] = chip

    if (options.attribute) {
      let attributeName = options.attribute
      // If the attribute name has an array syntax, add to the array
      if (options.attribute.endsWith("[]")) {
        // Take off the last 2 characters
        attributeName = attributeName.slice(0, attributeName.length - 2)
        let attributeAsArray = this[attributeName as keyof this] as Array<Chip>
        if (typeof attributeAsArray !== "undefined") {
          // Add to array
          attributeAsArray.push(chip)
        } else {
          // Create a new array
          attributeAsArray = [chip]
          // @ts-ignore
          this[attributeName] = attributeAsArray
        }

        // When the chip is terminated, remove the attribute
        this._subscribeOnce(chip, "terminated", (signal: Signal) => {
          // @ts-ignore
          const attributeAsArray = this[attributeName] as Array<Chip>
          const index = attributeAsArray.indexOf(chip!)
          attributeAsArray.splice(index, 1)
        })
      } else {
        // @ts-ignore
        this[attributeName] = chip

        // When the chip is terminated, delete the attribute
        this._subscribeOnce(chip, "terminated", (signal: Signal) => {
          delete this[attributeName as keyof this]
        })
      }
    }

    this.emit("beforeActivatedChildChip", chip, childContext, inputSignal)

    chip.activate(this._lastTickInfo, childContext, inputSignal, reloadMemento)

    if (options.includeInChildContext) {
      if (!providedId)
        throw util.shortStackError(
          "To include a child chip in the context, provide an attribute name or ID"
        )

      this._childChipContext[providedId] = chip

      // When the chip is terminated, remove from the context
      this._subscribeOnce(chip, "terminated", (signal: Signal) => {
        // @ts-ignore
        delete this._childChipContext[providedId]
      })
    }

    this.emit("activatedChildChip", chip, childContext, inputSignal)

    return chip
  }

  protected _terminateChildChip(chip: Chip, outputSignal?: Signal): void {
    if (this.state === "inactive")
      throw util.shortStackError("Composite is inactive")

    // Try to find value
    let childId: string | undefined
    for (const id in this._childChips) {
      if (this._childChips[id] === chip) {
        childId = id
        break
      }
    }
    if (!childId) throw util.shortStackError("Cannot find chip to terminate")

    chip.terminate(outputSignal)

    delete this._childChips[childId]

    this.emit("terminatedChildChip", chip)
  }

  /**
   * Check if child chips are still active, and remove them if not
   * Sends tick to all .
   */
  protected _tickChildChips(): void {
    for (const childChip of Object.values(this._childChips)) {
      if (childChip.state !== "inactive") childChip.tick(this._lastTickInfo)
    }

    this._removeTerminatedChildChips()
  }

  /** Terminate all the children, with the provided signal */
  protected _terminateAllChildChips(outputSignal?: Signal) {
    for (const childChip of Object.values(this._childChips)) {
      if (childChip.state === "active" || childChip.state === "paused") {
        childChip.terminate(outputSignal)
      }

      this.emit("terminatedChildChip", childChip)
    }

    this._childChips = {}
  }

  /** Remove any child chips */
  protected _removeTerminatedChildChips(): void {
    for (const id in this._childChips) {
      const childChip = this._childChips[id]

      if (childChip.state === "inactive") {
        delete this._childChips[id]
        this.emit("terminatedChildChip", childChip)
      }
    }
  }

  /**
   * Template getter for the chip context provided to children.
   * Overload to add extra attributes to the context.
   */
  get defaultChildChipContext(): ChipContextResolvable | undefined {
    return undefined
  }

  /** Template method called after children are ticked */
  protected _onAfterTick(): void {
    /* no op */
  }
}

export class ParallelOptions {
  terminateOnCompletion = true
}

/**
 * Executes a set of chips at the same time.
 * By default, terminates when all child chips have completed, unless `options.signalOnCompletion` is false.
 */
export class Parallel<
  ParallelEvents extends BaseCompositeEvents = BaseCompositeEvents
> extends Composite<ParallelEvents> {
  private readonly _options: ParallelOptions

  private _chipActivationInfos: ChipActivationInfo[] = []
  private _infoToChip = new Map<ChipActivationInfo, Chip>()
  private _activatedChipCount = 0

  constructor(
    chipActivationInfos: Array<ChipActivationInfo | ChipResolvable>,
    options?: Partial<ParallelOptions>
  ) {
    super()

    this._options = util.fillInOptions(options, new ParallelOptions())
    this._infoToChip = new Map()

    for (const e of chipActivationInfos) this.addChildChip(e)
  }

  /** Add a new chip. If the chip is running, activate it */
  addChildChip(e: ChipActivationInfo | ChipResolvable) {
    const info = isChipResolvable(e) ? { chip: e } : e
    this._chipActivationInfos.push(info)

    if (this.state !== "inactive") {
      // If no attribute or ID given, make a default one
      const infoWithId =
        info.attribute || info.id
          ? info
          : {
              ...info,
              id: this._activatedChipCount.toString(),
            }

      const chip = this._activateChildChip(info.chip, infoWithId)
      this._infoToChip.set(info, chip)

      this._activatedChipCount++
    }
  }

  _onActivate() {
    if (this._chipActivationInfos.length === 0) {
      // Empty set, stop immediately
      if (this._options.terminateOnCompletion) this.terminate(new Signal())
      return
    }

    // Activate all provided chips
    for (let i = 0; i < this._chipActivationInfos.length; i++) {
      const info = this._chipActivationInfos[i]
      // If no attribute or ID given, make a default one
      const infoWithId =
        info.attribute || info.id
          ? info
          : {
              ...info,
              id: this._activatedChipCount.toString(),
            }

      const chip = this._activateChildChip(info.chip, infoWithId)
      this._infoToChip.set(info, chip)

      this._activatedChipCount++
    }
  }

  _onAfterTick() {
    if (
      Object.keys(this._childChips).length === 0 &&
      this._options.terminateOnCompletion
    )
      this.terminate(new Signal())
  }

  /**
   * Remove the child chip, by value or index.
   * If the chip is running, terminate it
   */
  removeChildChip(e: ChipActivationInfo | ChipResolvable | number): void {
    let index: number
    if (typeof e === "number") {
      index = e
      if (index < 0 || index >= this._chipActivationInfos.length)
        throw util.shortStackError("Invalid index of chip to remove")
    } else {
      index = this.indexOfChipActivationInfo(e)
      if (index === -1) throw util.shortStackError("Cannot find chip to remove")
    }

    // Remove chip from _chipActivationInfos
    const activationInfo = this._chipActivationInfos[index]
    this._chipActivationInfos.splice(index, 1)

    if (this.state !== "inactive") {
      const chip = this._infoToChip.get(activationInfo)!

      // Remove chip  _infoToChip
      this._infoToChip.delete(activationInfo)

      // Terminate chip
      chip.terminate()
    }
  }

  indexOfChipActivationInfo(chip: ChipActivationInfo | ChipResolvable): number {
    if (isChipResolvable(chip)) {
      return this._chipActivationInfos.findIndex((x) => x.chip === chip)
    } else {
      return this._chipActivationInfos.indexOf(chip)
    }
  }
}

export class ContextProvider<
  ContextProviderEvents extends BaseCompositeEvents = BaseCompositeEvents
> extends Composite<ContextProviderEvents> {
  constructor(
    private readonly _context: Record<string, ChipResolvable>,
    private readonly _child: ChipResolvable
  ) {
    super()
  }

  protected _onActivate(): void {
    // First, activate the children that provide the context
    for (const name in this._context) {
      this._activateChildChip(this._context[name], {
        id: name,
        includeInChildContext: true,
      })
    }

    // Then activate the child
    {
      this._activateChildChip(this._child, {
        id: "child",
      })
    }
  }
}

export class SequenceOptions {
  loop = false
  terminateOnCompletion = true
}

/**
  Runs one child chip after another. 
  When done, terminates with output signal of the last chip in the sequence.
  Optionally can loop back to the first chip.
*/
export class Sequence<
  SequenceEvents extends BaseCompositeEvents = BaseCompositeEvents
> extends Composite<SequenceEvents> {
  private readonly _options: SequenceOptions

  private _chipActivationInfos: ChipActivationInfo[] = []
  private _currentChipIndex = 0
  private _currentChip?: Chip

  constructor(
    chipActivationInfos: Array<ChipActivationInfo | ChipResolvable>,
    options?: Partial<SequenceOptions>
  ) {
    super()

    this._options = util.fillInOptions(options, new SequenceOptions())

    for (const e of chipActivationInfos) this.addChildChip(e)
  }

  /** Add a new chip to the sequence */
  addChildChip(chip: ChipActivationInfo | ChipResolvable) {
    if (isChipResolvable(chip)) {
      this._chipActivationInfos.push({ chip: chip })
    } else {
      this._chipActivationInfos.push(chip)
    }

    if (this._state !== "inactive" && !this._currentChip) {
      // Pick up with the next chip
      this._switchChip()
    }
  }

  /** Skips to the next chip */
  skip() {
    this._advance(new Signal("skip"))
  }

  private _switchChip() {
    // Stop current chip
    if (this._currentChip) {
      // The current chip may have already been terminated, if it terminated before
      if (Object.keys(this._childChips).length > 0)
        this._terminateChildChip(this._currentChip)
      delete this._currentChip
    }

    if (this._currentChipIndex < this._chipActivationInfos.length) {
      const info = this._chipActivationInfos[this._currentChipIndex]

      // If no attribute or ID given, make a default one
      const infoWithId =
        info.attribute || info.id
          ? info
          : {
              ...info,
              id: (this._chipActivationInfos.length - 1).toString(),
            }

      this._currentChip = this._activateChildChip(info.chip, infoWithId)
    }
  }

  _onActivate() {
    this._currentChipIndex =
      (this._reloadMemento?.data?.currentChipIndex as number) ?? 0
    delete this._currentChip

    if (this._chipActivationInfos.length === 0) {
      // Empty Sequence, stop immediately
      if (this._options.terminateOnCompletion) this.terminate(new Signal())
    } else {
      // Start the Sequence
      this._switchChip()
    }
  }

  _onAfterTick() {
    if (!this._currentChip) return

    const signal = this._currentChip.outputSignal
    if (signal) this._advance(signal)
  }

  _onTerminate() {
    delete this._currentChip
  }

  /** Restart the sequence on the first chip */
  restart() {
    this._currentChipIndex = 0
    this._switchChip()
  }

  private _advance(signal: Signal) {
    this._currentChipIndex++
    this._switchChip()

    // If we've reached the end of the Sequence...
    if (this._currentChipIndex >= this._chipActivationInfos.length) {
      if (this._options.loop) {
        // ... and we loop, go back to start
        this._currentChipIndex = 0
        this._switchChip()
      } else if (this._options.terminateOnCompletion) {
        // otherwise terminate
        this.terminate(signal)
      }
    }
  }

  protected _makeReloadMementoData(): ReloadMementoData {
    return {
      currentChipIndex: this._currentChipIndex,
    }
  }
}

export type StateTable = {
  [key in string]: ChipActivationInfo
}

export type SignalFunction<SignalName extends string> = (
  context: ChipContext,
  signal: Signal<SignalName>
) => Signal<SignalName>
export type SignalDescriptor<SignalName extends string> =
  | Signal<SignalName>
  | SignalFunction<SignalName>
export type SignalTable<SignalName extends string> = {
  [k in string]: SignalDescriptor<SignalName>
}

export interface BaseStateMachineEvents<SignalName extends string>
  extends BaseCompositeEvents {
  stateChange: [
    previousState: Signal<SignalName> | undefined,
    nextState: Signal<SignalName>
  ]
}

export interface StateMachineOptions<SignalName extends string> {
  startingState: Signal<SignalName> | SignalName
  signals?: Partial<
    Record<SignalName, SignalDescriptor<SignalName> | SignalName>
  >
  endingStates?: (SignalName | string)[]
}

/**
 * Represents a state machine, where each state has a name, and is represented by an chip.
 * Only one state is active at a time.
 * The state machine has one starting state, but can have multiple ending states.
 * When the machine reaches an ending state, it terminates with a name equal to the name of the ending state.
 * By default, the state machine begins at the state called "start", and stops at "end".
 *
 * When the active state chip terminates, the state machine transitions to another.
 * To determine the next state, it first looks if there is a corresponding entry in the `signals` table, which
 * can be either a state name or a function that takes `(ChipContext, Signal)` and returns a signal.
 * If there is nothing in the signal table for the state, it next looks if the terminating signal is the name of another
 * state, in which case it switches directly to that state,
 *
 * If you want to create embedded signal tables, try the `makeSignalTable()` function.
 *
 * Events:
 * - stateChange(previousState: Signal, nextState: Signal)
 */
export class StateMachine<
  States extends Record<string, ChipActivationInfo | ChipResolvable>,
  StateMachineEvents extends BaseStateMachineEvents<
    keyof States & string
  > = BaseStateMachineEvents<keyof States & string>
> extends Composite<StateMachineEvents> {
  private readonly _states: StateTable
  private readonly _transitions: SignalTable<keyof States & string>
  private readonly _startingState: SignalDescriptor<keyof States & string>
  private _visitedStates!: Signal<keyof States & string>[]
  private _activeChildChip?: Chip
  private _lastSignal?: Signal<keyof States & string>

  constructor(
    states: States,
    public readonly options: StateMachineOptions<keyof States & string>
  ) {
    super()

    // Create state table
    this._states = Object.fromEntries(
      Object.entries<ChipActivationInfo | ChipResolvable>(states).map(
        ([name, chip]) => {
          if (isChipResolvable(chip)) return [name, { chip }] as const
          return [name, chip] as const
        }
      )
    )

    // Ensure all signals are of the correct type
    if (typeof this.options.startingState === "string")
      this._startingState = new Signal(this.options.startingState)
    else this._startingState = this.options.startingState

    if (this.options.signals) {
      this._transitions = Object.fromEntries(
        Object.entries(this.options.signals).map(([name, signal]) => {
          if (typeof signal === "string")
            return [name, new Signal(signal)] as const
          return [name, signal!] as const
        })
      )
    } else {
      this._transitions = {}
    }
  }

  activate(
    tickInfo: TickInfo,
    chipContext: ChipContext,
    inputSignal?: Signal,
    reloadMemento?: ReloadMemento
  ) {
    super.activate(tickInfo, chipContext, inputSignal, reloadMemento)

    this._visitedStates = []

    if (this._reloadMemento) {
      this._visitedStates = this._reloadMemento.data?.visitedStates ?? []
      this._changeState(_.last(this._visitedStates) ?? new Signal())
    } else {
      const startingState = _.isFunction(this._startingState)
        ? this._startingState(chipContext, new Signal())
        : this._startingState
      this._changeState(startingState)
    }
  }

  _onAfterTick() {
    if (!this._activeChildChip) return

    const signal = this._activeChildChip.outputSignal
    if (signal && this._lastSignal) {
      let nextStateDescriptor: Signal<keyof States & string>
      // The signal could directly be the name of another state, or ending state
      if (!(this._lastSignal.name in this._transitions)) {
        if (
          signal.name in this._states ||
          this.options.endingStates?.includes(signal.name)
        ) {
          nextStateDescriptor = signal as Signal<keyof States & string>
        } else {
          throw util.shortStackError(
            `Cannot find signal for state '${signal.name}'`
          )
        }
      } else {
        const signalDescriptor: SignalDescriptor<keyof States & string> =
          this._transitions[this._lastSignal.name]
        if (_.isFunction(signalDescriptor)) {
          nextStateDescriptor = signalDescriptor(this._chipContext, signal)
        } else {
          nextStateDescriptor = signalDescriptor
        }
      }

      // Unpack the next state
      let nextState: Signal<keyof States & string>
      if (
        !nextStateDescriptor.params ||
        _.isEmpty(nextStateDescriptor.params)
      ) {
        // By default, pass through the params in the input signal
        nextState = new Signal(nextStateDescriptor.name, signal.params)
      } else {
        nextState = nextStateDescriptor
      }

      this._changeState(nextState)
    }
  }

  _onTerminate() {
    delete this._activeChildChip
    delete this._lastSignal
  }

  protected _makeReloadMementoData(): ReloadMementoData {
    return {
      visitedStates: this._visitedStates,
    }
  }

  /** Switch directly to a new state, terminating the current one */
  changeState(
    nextState: (keyof States & string) | Signal<keyof States & string>
  ): void {
    if (typeof nextState === "string") {
      nextState = new Signal(nextState)
    }

    this._changeState(nextState)
  }

  private _changeState(nextState: Signal<keyof States & string>): void {
    // Stop current state
    if (this._activeChildChip) {
      // The state may have already been terminated, if terminated
      if (Object.keys(this._childChips).length > 0)
        this._terminateChildChip(this._activeChildChip)
      delete this._activeChildChip
    }

    // If reached an ending state, stop here.
    if (this.options.endingStates?.includes(nextState.name)) {
      this._lastSignal = nextState
      this._visitedStates.push(nextState)

      // Terminate with signal
      this.terminate(nextState)
      return
    }

    if (nextState.name in this._states) {
      const nextStateContext = this._states[nextState.name]
      this._activeChildChip = this._activateChildChip(nextStateContext.chip, {
        context: nextStateContext.context,
        inputSignal: nextState,
        id: nextState.name,
      })
    } else {
      throw util.shortStackError(`Cannot find state '${nextState.name}'`)
    }

    const previousSignal = this._lastSignal
    this._lastSignal = nextState

    this._visitedStates.push(nextState)

    this.emit("stateChange", previousSignal, nextState)
  }

  /** The last signal used by the machine. If the machine is running, this describes the current state */
  get lastSignal() {
    return this._lastSignal
  }

  /** An array of all the signals the machine has gone through, in order. It may contain duplicates */
  get visitedStates() {
    return this._visitedStates
  }
}

export interface FunctionalFunctions<
  FunctionalEvents extends BaseCompositeEvents = BaseCompositeEvents
> {
  activate: (chip: Functional<FunctionalEvents>) => void
  tick: (chip: Functional<FunctionalEvents>) => void
  pause: (chip: Functional<FunctionalEvents>) => void
  resume: (chip: Functional<FunctionalEvents>) => void
  terminate: (chip: Functional<FunctionalEvents>) => void
  shouldTerminate: (
    chip: Functional<FunctionalEvents>
  ) => Signal | string | boolean
  makeReloadMemento(): ReloadMemento
}

/**
  An chip that gets its behavior from functions provided inline in the constructor.
  Useful for small chips that don't require their own class definition.
  Additionally, a function called shouldTerminate(options, chip), called after activate() and tick(), can return a signal

  Example usage:
    new Functional({
      activate: (chipContext) => console.log("activate", chipContext),
      terminate: () => console.log("terminate"),
    });
*/
export class Functional<
  FunctionalEvents extends BaseCompositeEvents = BaseCompositeEvents
> extends Composite<FunctionalEvents> {
  constructor(
    public readonly functions: Partial<FunctionalFunctions<FunctionalEvents>>
  ) {
    super()
  }

  protected get lastFrameInfo(): TickInfo {
    return this._lastTickInfo
  }
  protected get inputSignal(): Signal | undefined {
    return this._inputSignal
  }
  protected get reloadMemento(): ReloadMemento | undefined {
    return this._reloadMemento
  }

  protected _onActivate() {
    if (this.functions.activate) this.functions.activate(this)
    this._checkForTermination()
  }

  protected _onTick() {
    if (this.functions.tick) this.functions.tick(this)
    this._checkForTermination()
  }

  protected _onPause() {
    if (this.functions.pause) this.functions.pause(this)
  }

  protected _onResume() {
    if (this.functions.resume) this.functions.resume(this)
  }

  protected _onTerminate() {
    if (this.functions.terminate) this.functions.terminate(this)
  }

  private _checkForTermination() {
    if (!this.functions.shouldTerminate) return

    const result = this.functions.shouldTerminate(this)
    if (result) {
      if (_.isString(result)) {
        this.terminate(new Signal(result))
      } else if (_.isObject(result)) {
        this.terminate(result)
      } else {
        // result is true
        this.terminate(new Signal())
      }
    }
  }
}

/**
  An chip that calls a provided function just once (in activate), and immediately terminates.
  If the function returns a signal, will terminate with that signal.
  Optionally takes a @that parameter, which is set as _this_ during the call. 
*/
export class Lambda<That> extends ChipBase {
  constructor(public f: (that?: That) => unknown, public that?: That) {
    super()
  }

  _onActivate() {
    const result = this.that ? this.f.bind(this.that)(this.that) : this.f()

    if (typeof result === "string") this.terminate(new Signal(result))
    else if (isSignal(result)) this.terminate(result)
    else this.terminate(new Signal())
  }
}

/** Waits until time is up, then requests signal */
export class Wait extends ChipBase {
  private _accumulatedTime!: number

  /** @wait is in milliseconds */
  constructor(public readonly wait: number) {
    super()
  }

  _onActivate() {
    this._accumulatedTime = 0
  }

  _onTick() {
    this._accumulatedTime += this._lastTickInfo.timeSinceLastTick

    if (this._accumulatedTime >= this.wait) {
      this.terminate()
    }
  }
}

/**
 * Does not terminate until done() is called with a given signal
 */
export class Block extends ChipBase {
  done(signal = new Signal()) {
    this.terminate(signal)
  }
}

/**
 * Waits for an event to be delivered, and decides to request a signal depending on the event value.
 * @handler is a function of the event arguments, and should return either a signal or a boolean as to whether to signal or not
 */
export class WaitForEvent<
  Emitter extends object,
  EventNames extends Emitter extends ChipBase<infer _EventNames>
    ? _EventNames
    : BaseEventNames,
  EventName extends keyof EventNames & string
> extends ChipBase {
  constructor(
    public emitter: Emitter,
    public eventName: EventName,
    public handler: (...args: EventNames[EventName]) => Signal | boolean = () =>
      true
  ) {
    super()
  }

  _onActivate() {
    this._subscribe(this.emitter, this.eventName, this._handleEvent)
  }

  _handleEvent(...args: EventNames[EventName]) {
    const result = this.handler(...args)
    if (!result) return

    if (_.isObject(result)) {
      this.terminate(result)
    } else {
      // result is true
      this.terminate()
    }
  }
}

export interface AlternativeChipActivationInfo extends ChipActivationInfo {
  signal?: Signal
}

/**
 *  Chip that requests a signal as soon as one of it's children requests one
 */
export class Alternative extends Composite {
  private readonly _chipActivationInfos: AlternativeChipActivationInfo[]

  // signal defaults to the string version of the index in the array (to avoid problem of 0 being considered as falsy)
  constructor(
    chipActivationInfos: Array<ChipResolvable | AlternativeChipActivationInfo>
  ) {
    super()

    // Set default signal as the string version of the index in the array (to avoid problem of 0 being considered as falsy)
    this._chipActivationInfos = chipActivationInfos.map((info, key) => {
      if (isChip(info) || typeof info === "function") {
        return {
          chip: info,
        }
      } else {
        return info
      }
    })
  }

  _onActivate() {
    for (let i = 0; i < this._chipActivationInfos.length; i++) {
      const chipActivationInfo = this._chipActivationInfos[i]
      const chip = resolveChip(
        chipActivationInfo.chip,
        chipActivationInfo.context ?? {}
      )

      if (!chip) continue

      this._subscribe(chip, "terminated", () => this._onChildTerminated(i))
      this._activateChildChip(chipActivationInfo.chip, {
        context: chipActivationInfo.context,
      })
    }
  }

  private _onChildTerminated(index: number) {
    const terminateWith =
      this._chipActivationInfos[index].signal ?? new Signal(index.toString())
    this.terminate(terminateWith)
  }
}

export type QueueItemState = "running" | "finished" | "waiting"

export interface QueueItem {
  state: QueueItemState
  context: ChipContext
  entityResolvable: ChipResolvable
}

/**
 * Chip that runs a set of chips in sequence, one after the other. <br>
 * When the last chip terminates, the queue is waiting for a new chip to be added.
 */
export class Queue extends Composite {
  private _queue: QueueItem[] = []

  get isEmpty() {
    return this._queue.length === 0
  }

  public add(
    item: ChipResolvable,
    context: ChipContext = this.chipContext
  ): this {
    this._queue.push({
      state: "waiting",
      entityResolvable: item,
      context,
    })

    return this
  }

  /**
   * Terminates the currently running chip, and starts the next one.
   */
  public next() {
    if (this._queue.length === 0) return

    const item = this._queue.find((item) => item.state === "running")

    if (item) resolveChip(item.entityResolvable, item.context)?.terminate()
  }

  protected _onTick() {
    this._queue = this._queue.filter((item) => {
      const finished = item.state === "finished"
      return !finished
    })

    if (this._queue.length === 0) return

    const item = this._queue[0] ?? undefined

    if (item.state !== "waiting") return

    this._activateItem(item)
  }

  protected _onTerminate() {
    this._queue = []
  }

  private _activateItem(item: QueueItem) {
    item.state = "running"

    this._activateChildChip(
      new Sequence([
        item.entityResolvable,
        new Lambda(() => {
          item.state = "finished"
        }),
      ]),
      {
        context: item.context,
      }
    )
  }
}
