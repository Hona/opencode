import { Hono } from "hono"
import { Instance } from "../../project/instance"
import { InstanceBootstrap } from "../../project/bootstrap"
import { SessionRoutes } from "../../server/routes/session"
import { WorkspaceServerRoutes } from "./routes"
import { WorkspaceContext } from "../workspace-context"
import { WorkspaceID } from "../schema"
import { Path } from "../../path/path"
import { HTTPException } from "hono/http-exception"

function badInput(err: unknown) {
  return new HTTPException(400, {
    message: err instanceof Error ? err.message : "Invalid request",
  })
}

export namespace WorkspaceServer {
  export function App() {
    const session = new Hono()
      .use(async (c, next) => {
        // Right now, we need handle all requests because we don't
        // have syncing. In the future all GET requests will handled
        // by the control plane
        //
        // if (c.req.method === "GET") return c.notFound()
        await next()
      })
      .route("/", SessionRoutes())

    return new Hono()
      .use(async (c, next) => {
        const rawWorkspaceID = c.req.query("workspace") || c.req.header("x-opencode-workspace")
        const raw = c.req.query("directory") || c.req.header("x-opencode-directory")
        if (rawWorkspaceID == null) {
          throw new HTTPException(400, { message: "workspace parameter is required" })
        }
        if (raw == null) {
          throw new HTTPException(400, { message: "directory parameter is required" })
        }

        const workspaceID = (() => {
          try {
            return WorkspaceID.parse(rawWorkspaceID)
          } catch (err) {
            throw badInput(err)
          }
        })()
        const directory = (() => {
          try {
            return Path.ingress(raw, { label: "directory parameter" })
          } catch (err) {
            throw badInput(err)
          }
        })()

        return WorkspaceContext.provide({
          workspaceID,
          async fn() {
            return Instance.provide({
              directory,
              init: InstanceBootstrap,
              async fn() {
                return next()
              },
            })
          },
        })
      })
      .route("/session", session)
      .route("/", WorkspaceServerRoutes())
  }

  export function Listen(opts: { hostname: string; port: number }) {
    return Bun.serve({
      hostname: opts.hostname,
      port: opts.port,
      fetch: App().fetch,
    })
  }
}
