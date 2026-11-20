import { STATUS_LABEL, type Status } from "@/lib/books/constants";

export type StatusMarkerInfo = {
  status: Status;
  /** Visible text for the compact list form. */
  label: string;
  /** Accessible name for the icon-only cover form. */
  name: string;
};

/** What to show for a book's "my status": nothing when the reader has no status on it. */
export function statusMarkerInfo(status: Status | null | undefined): StatusMarkerInfo | null {
  if (!status || !(status in STATUS_LABEL)) return null;
  return { status, label: STATUS_LABEL[status], name: `My status: ${STATUS_LABEL[status]}` };
}
