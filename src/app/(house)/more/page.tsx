import { redirect } from "next/navigation";

/** More was renamed Settings; its links moved to Home. Old bookmarks and home-screen shortcuts still work. */
export default function MorePage() {
  redirect("/settings");
}
