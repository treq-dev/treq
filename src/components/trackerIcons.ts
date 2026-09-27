import { Ticket, Trello, type LucideIcon } from "lucide-react";
import type { TrackerProvider } from "../lib/trackers";

export const TRACKER_ICONS: Record<TrackerProvider, LucideIcon> = {
  trello: Trello,
  jira: Ticket,
};
