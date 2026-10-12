import type { Metadata } from "next";
import ScheduleManager from "./ScheduleManager";

export const metadata: Metadata = { title: "Admin · Schedule" };

export default function AdminSchedulePage() {
  return <ScheduleManager />;
}
