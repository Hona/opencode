import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { plugin } from "bun"
import { SolidPlugin } from "bun-plugin-solid"

GlobalRegistrator.register()
plugin(SolidPlugin())
