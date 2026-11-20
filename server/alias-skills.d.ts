declare module "*/vendor/lib/setup.mjs" {
  export function scanSetup(input: { home: string; cwd: string; env?: Record<string, string | undefined> }): import("./audit").Setup;
}
declare module "*/vendor/core/setup.mjs" {
  export function publicProfile(setup: import("./audit").Setup): import("../shared/alias").Profile;
}
