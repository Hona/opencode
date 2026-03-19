import { useParams } from "@solidjs/router"
import { createMemo } from "solid-js"
import { useLayout } from "@/context/layout"
import { sessionKey } from "@/utils/session-key"

export const useSessionKey = () => {
  const params = useParams()
  const key = createMemo(() => sessionKey(params.dir ?? "", params.id))
  return { params, sessionKey: key }
}

export const useSessionLayout = () => {
  const layout = useLayout()
  const { params, sessionKey } = useSessionKey()
  return {
    params,
    sessionKey,
    tabs: createMemo(() => layout.tabs(sessionKey)),
    view: createMemo(() => layout.view(sessionKey)),
  }
}
