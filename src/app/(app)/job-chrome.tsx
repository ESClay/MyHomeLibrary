import { JobNotice } from "@/components/job-notice";
import { BottomTabs, SidebarNav } from "@/components/nav";
import { jobNoticeText, jobReviewHref, jobReviewLabel } from "@/lib/jobs/queue/describe";
import { loadUnseenJobs } from "@/lib/jobs/queue/queries";

/*
 * The two places background jobs show up outside the Activity page. Both read the same cached query and are rendered
 * inside <Suspense> in the layout, so the page and its navigation never wait on the jobs table.
 */

export async function SidebarNavWithBadge({ userId }: { userId: string }) {
  return <SidebarNav unseen={(await loadUnseenJobs(userId)).length} />;
}

export async function BottomTabsWithBadge({ userId }: { userId: string }) {
  return <BottomTabs unseen={(await loadUnseenJobs(userId)).length} />;
}

/** A dismissible line about the newest finished job that has not been opened yet. */
export async function FinishedJobNotice({ userId }: { userId: string }) {
  const [job] = await loadUnseenJobs(userId);
  if (!job) return null;
  const label = jobReviewLabel(job);
  return <JobNotice jobId={job.id} text={jobNoticeText(job)} href={label ? jobReviewHref(job) : "/activity"} label={label ?? "Open Activity"} />;
}
