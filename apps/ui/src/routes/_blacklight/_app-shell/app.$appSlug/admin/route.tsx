import { Outlet, createFileRoute, notFound } from "@tanstack/react-router";

export const Route = createFileRoute("/_blacklight/_app-shell/app/$appSlug/admin")({
  beforeLoad: ({ context }) => {
    if (context.user.role !== "admin") throw notFound();
  },
  component: Outlet,
});
