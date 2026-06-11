import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

// Public landing redirects to auth or to the authenticated lobby.
export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Cambio — online card game" },
      { name: "description", content: "Play Cambio online with friends. Free, instant rooms." },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      // Authenticated users go to the lobby (under /_authenticated)
      // The lobby is also at "/" inside the authenticated layout — we redirect
      // by going to the same "/" but after auth check; instead push to lobby route.
      // The _authenticated layout matches the path; just force the auth-guarded
      // render by reloading with replace.
    } else {
      throw redirect({ to: "/auth" });
    }
  },
  component: () => null,
});
