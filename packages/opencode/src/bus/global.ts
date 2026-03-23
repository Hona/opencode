import { EventEmitter } from "events"

interface GlobalBusEvent {
  directory?: string
  payload: any
}

export const GlobalBus = new EventEmitter<{
  event: [GlobalBusEvent]
}>()
