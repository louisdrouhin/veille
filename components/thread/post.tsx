import { PlatformBadge, PostTypeBadge, type PostType } from "@/components/ui/badge";
import { SourceAvatar } from "@/components/ui/source-avatar";
import { formatFull, formatShort, formatTitle } from "@/lib/format-date";

export type PostAuthorData = {
  name: string;
  role: string;
  muted?: boolean;
  /** Stored favicon (faviconUrl()), null → initial. */
  faviconSrc?: string | null;
  platform?: string; // v2 comments: « Hacker News », « Reddit »
};

function PostAuthor({ type, author }: { type: PostType; author: PostAuthorData }) {
  const avatar =
    type === "note" ? (
      <span
        aria-hidden="true"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent font-cond text-sm font-bold text-accent-fg md:size-10 md:text-md"
      >
        {(author.name.trim()[0] ?? "?").toUpperCase()}
      </span>
    ) : (
      <>
        <span className="md:hidden">
          <SourceAvatar name={author.name} src={author.faviconSrc} size={32} shape={type === "comment" ? "round" : "square"} />
        </span>
        <span className="hidden md:inline-flex">
          <SourceAvatar
            name={author.name}
            src={author.faviconSrc}
            size={type === "topic" ? 52 : 40}
            shape={type === "comment" ? "round" : "square"}
          />
        </span>
      </>
    );

  return (
    <div className="flex w-full items-center gap-2.5 border-b border-line px-3.5 py-2.5 md:w-auto md:shrink-0 md:basis-[168px] md:flex-col md:justify-start md:gap-2 md:border-r md:border-b-0 md:p-4 md:text-center">
      {avatar}
      <div className="flex min-w-0 flex-col md:items-center">
        <span className={`truncate text-base font-semibold ${author.muted ? "italic text-fg-read" : ""}`}>{author.name}</span>
        <span className="text-xs text-fg-muted">{author.role}</span>
        {author.platform && (
          <span className="mt-1">
            <PlatformBadge name={author.platform} />
          </span>
        )}
      </div>
    </div>
  );
}

export function Post({
  n,
  type,
  author,
  date,
  children,
}: {
  n: number;
  type: PostType;
  author: PostAuthorData;
  date: Date;
  children: React.ReactNode;
}) {
  const isNote = type === "note";
  return (
    <article
      id={`p${n}`}
      className={`scroll-mt-4 overflow-hidden rounded-md border bg-surface shadow-sm ${isNote ? "border-accent" : "border-line"}`}
    >
      <div
        className={`flex min-h-7.5 items-center justify-between gap-2 border-b px-3.5 text-xs text-fg-muted ${
          isNote ? "border-accent bg-accent-soft" : "border-line bg-surface-alt"
        }`}
      >
        <div className="flex items-center gap-2">
          <a href={`#p${n}`} className="font-mono text-fg-muted hover:text-fg" aria-label={`Message n° ${n}`}>
            #{n}
          </a>
          <PostTypeBadge type={type} />
        </div>
        <time dateTime={date.toISOString()} title={formatTitle(date)}>
          <span className="hidden md:inline">{formatFull(date)}</span>
          <span className="md:hidden">{formatShort(date)}</span>
        </time>
      </div>
      <div className="flex flex-wrap">
        <PostAuthor type={type} author={author} />
        <div className="flex min-w-0 flex-[999_1_420px] flex-col gap-3 px-3.5 py-3.5 md:px-5.5 md:py-4">{children}</div>
      </div>
    </article>
  );
}
