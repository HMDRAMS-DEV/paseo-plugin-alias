import type { PluginServerContext } from "@getpaseo/plugin/server";
import { audit, linkX, saveSetup, share } from "./server/audit";
import { auditRpc, linkXRpc, saveSetupRpc, shareRpc } from "./shared/alias";

export default function contribute(server: PluginServerContext) {
  server.handle(auditRpc, audit);
  server.handle(shareRpc, share);
  server.handle(linkXRpc, linkX);
  server.handle(saveSetupRpc, saveSetup);
  return () => {};
}
