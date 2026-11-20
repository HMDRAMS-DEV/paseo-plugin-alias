import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const profile = z.object({
  agent: z.string(),
  agents: z.record(z.string(), z.number()),
  used: z.array(z.object({ name: z.string(), count: z.number() })),
  neverUsed: z.array(z.string()),
});

const x = z.object({ handle: z.string(), name: z.string(), avatar: z.string(), verified: z.boolean() }).nullable();

export type Profile = z.infer<typeof profile>;

export const auditRpc = defineRpc({
  name: "alias.audit",
  input: z.object({}),
  output: z.object({
    // Exactly what Share publishes.
    profile,
    broken: z.array(
      z.object({
        name: z.string(),
        path: z.string(),
        used: z.number(),
        fixes: z.array(z.object({ command: z.string(), why: z.string() })),
      }),
    ),
    sharedUrl: z.string().nullable(),
    x,
    home: z.string(),
  }),
});

export const shareRpc = defineRpc({
  name: "alias.share",
  input: z.object({ public: z.boolean() }),
  output: z.object({ sharedUrl: z.string().nullable() }),
});

// Links an X account to the public profile by handle or profile URL. null removes it.
export const linkXRpc = defineRpc({
  name: "alias.link_x",
  input: z.object({ handle: z.string().nullable() }),
  output: z.object({ x }),
});

export const COMMUNITY_URL = "https://alias.computer/skills";
