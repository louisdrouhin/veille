import { LIST_BG } from "@/lib/lists/palette";
import { avatarColor, initials, type PersonName } from "@/lib/profile";

export type AvatarUser = PersonName & { id: string; photo?: number | null };

/** URL of the profile picture (authenticated route, private cache); `v` changes with each new picture. */
export const photoUrl = (photo: number, size: "small" | "large") => `/api/profil/photo?taille=${size === "small" ? 64 : 512}&v=${photo}`;

/**
 * The account's picture, round (docs/design/3.5 § 5); without one, its initials on a list color chosen from the
 * identifier (stable), text in --surface (AA in both themes). Decorative: the name is always next to it.
 */
export function UserAvatar({ user, size, className = "" }: { user: AvatarUser; size: number; className?: string }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (user.photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- our own authenticated route, already 64 / 512 px
      <img src={photoUrl(user.photo, size > 64 ? "large" : "small")} alt="" width={size} height={size} style={style} className={`shrink-0 rounded-full object-cover ${className}`} />
    );
  }
  return (
    <span aria-hidden style={style} className={`inline-flex shrink-0 items-center justify-center rounded-full font-cond font-bold text-surface ${LIST_BG[avatarColor(user.id)]} ${className}`}>
      {initials(user)}
    </span>
  );
}
