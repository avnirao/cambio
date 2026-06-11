import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

function randomPlayerName() {
  return `Player${Math.floor(Math.random() * 9000 + 1000)}`;
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    let { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      const username = randomPlayerName();
      const { data: signInData, error: signInError } = await supabase.auth.signInAnonymously({
        options: { data: { username } },
      });
      if (signInError || !signInData.user) throw redirect({ to: "/auth" });
      await supabase.from("profiles").upsert({ id: signInData.user.id, username });
      data = { user: signInData.user };
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
