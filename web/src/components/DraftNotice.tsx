/** Prominent banner for legal pages that are not yet finalised. */
export function DraftNotice() {
  return (
    <div
      role="note"
      className="rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <strong className="font-semibold">
        DRAFT — REQUIRES LEGAL REVIEW BEFORE PRODUCTION.
      </strong>{" "}
      This document is a working draft to describe intended practices. It is not
      legal advice and is not the final policy. It must be reviewed and approved
      by a qualified legal adviser before AaminPay launches.{" "}
      <span className="font-semibold">
        TODO-LEGAL: replace this page with the lawyer&apos;s final text, then
        remove this notice.
      </span>
    </div>
  );
}
