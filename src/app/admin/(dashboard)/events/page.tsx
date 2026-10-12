import type { Metadata } from "next";
import EventsManager from "./EventsManager";

export const metadata: Metadata = { title: "Admin · Events" };

export default function AdminEventsPage() {
  return <EventsManager />;
}
