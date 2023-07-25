/**
 * Event source that uses a Node.js-like interface using `on()` and `off()`.
 */
export interface NodeEventSource {
  on(type: string, listener: () => void): void
  once(type: string, listener: () => void): void
  off(type: string, listener: () => void): void
  emit(type: string, ...args: unknown[]): void
}

export function isNodeEventSource(emitter: object): emitter is NodeEventSource {
  return typeof (emitter as NodeEventSource).on === "function"
}

export function isEventTarget(emitter: object): emitter is EventTarget {
  return typeof (emitter as EventTarget).addEventListener === "function"
}

export type UnsubscribeFunction = (
  emitter: object,
  event: string,
  cb: () => void
) => void

export interface SubscriptionHandler {
  subscribe(emitter: object, event: string, cb: () => void): void
  subscribeOnce(emitter: object, event: string, cb: () => void): void
  unsubscribe(emitter: object, event: string, cb: () => void): void
}

export class NodeEventSourceSubscriptionHandler implements SubscriptionHandler {
  subscribe(emitter: NodeEventSource, event: string, cb: () => void): void {
    emitter.on(event, cb)
  }

  subscribeOnce(emitter: NodeEventSource, event: string, cb: () => void): void {
    emitter.once(event, cb)
  }

  unsubscribe(emitter: NodeEventSource, event: string, cb: () => void): void {
    emitter.off(event, cb)
  }
}

export class EventTargetSubscriptionHandler implements SubscriptionHandler {
  subscribe(emitter: EventTarget, event: string, cb: () => void): void {
    emitter.addEventListener(event, cb)
  }

  subscribeOnce(emitter: EventTarget, event: string, cb: () => void): void {
    emitter.addEventListener(event, cb, { once: true })
  }

  unsubscribe(emitter: EventTarget, event: string, cb: () => void): void {
    emitter.removeEventListener(event, cb)
  }
}

export interface IEventListener {
  emitter: object
  event: string
  cb: () => void
  subscriptionHandler: SubscriptionHandler
}
