import "server-only";
import { cache } from "react";
import { getAuthUser } from "@/server/auth/session";
import { parseAppearance, type Appearance } from "@/components/appearance";

/**
 * The signed-in member's theme preference; dark when signed out or unconfigured.
 * Display only, never used for authorisation. Shares the request's one Auth call with getSession.
 */
export const getAppearance = cache(async function getAppearance(): Promise<Appearance> {
  try {
    const auth = await getAuthUser();
    return parseAppearance(auth?.user.user_metadata);
  } catch {
    return "dark";
  }
});
