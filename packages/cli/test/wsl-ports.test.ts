import { expect, test } from "bun:test"
import { WslPorts } from "../src/services/wsl-ports"

test("lists listening ports from /proc/net/tcp tables", () => {
  // Real /proc/net/tcp shape: state 0A is LISTEN, 01 is ESTABLISHED, port is hex after the colon.
  const table = [
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
    "   0: FEFFFF0A:0035 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 7179 1 00000000f8fa8b0d 100 0 0 10 0",
    "   1: 0100007F:C0DE 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 17581 1 00000000b88dfac1 100 0 0 10 0",
    "   2: 0100007F:C0DE 0100007F:9C40 01 00000000:00000000 00:00000000 00000000  1000        0 17600 1 00000000b88dfac2 100 0 0 10 0",
    "  sl  local_address                         rem_address                         st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
    "   0: 00000000000000000000000000000000:1F90 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 9001 1 00000000aaaaaaaa 100 0 0 10 0",
    "",
  ].join("\n")
  expect(WslPorts.listening(table)).toEqual([53, 0xc0de, 8080])
})
