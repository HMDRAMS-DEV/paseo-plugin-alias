import type { PluginServerContext } from "@getpaseo/plugin/server";
import { audit, linkX, share } from "./server/audit";
import { auditRpc, linkXRpc, shareRpc } from "./shared/alias";

export default function contribute(server: PluginServerContext) {
  server.handle(auditRpc, audit);
  server.handle(shareRpc, share);
  server.handle(linkXRpc, linkX);
  return () => {};
}
