import { ObjectRow } from "@/components/ui";

/**
 * Compact identity rows — a list of people, wherever people are listed.
 *
 * Promoted out of the Explore route because Home's rail needs the same rows
 * for "Builders to follow" (H-4) and Explore's breaker needs them again
 * (E-4), and a route may not import another route's components. The shape is
 * unchanged: avatar, name, and one line that says who they are.
 */

export type AccountRowAccount = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  headline?: string | null;
  profile_type?: string | null;
  /** Optional trailing line for context a list can add ("3 cars · 8 updates"). */
  meta?: string | null;
};

export function AccountRowList({
  accounts,
  action,
}: {
  accounts: AccountRowAccount[];
  /** Trailing control per row — a Follow button on a suggestion list. */
  action?: (account: AccountRowAccount) => React.ReactNode;
}) {
  return (
    <div className="rowlist">
      {accounts.map((account) => {
        const name = account.display_name ?? (account.username ? `@${account.username}` : "Account");
        const meta =
          account.meta ??
          [
            account.display_name && account.username ? `@${account.username}` : null,
            account.profile_type === "shop" ? "Shop" : null,
            account.headline,
          ]
            .filter(Boolean)
            .join(" · ");
        return (
          <ObjectRow
            key={account.id}
            as="div"
            href={account.username ? `/u/${account.username}` : undefined}
            media={{ src: account.avatar_url ?? undefined, alt: name }}
            title={name}
            meta={meta || undefined}
            actions={action?.(account)}
          />
        );
      })}
    </div>
  );
}
