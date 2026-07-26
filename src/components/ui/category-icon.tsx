import type { CategoryIcon as CategoryIconName } from "@/lib/marketplace/taxonomy";

const paths: Record<CategoryIconName, React.ReactNode> = {
  // Turbo / downpipe swirl
  turbo: (
    <>
      <circle cx="10" cy="12" r="5.5" />
      <path d="M10 6.5V3M10 21v-3.5M4.5 12H2M10 9.5a2.5 2.5 0 1 0 2.5 2.5" />
      <path d="M15.5 12h4.5l2 4h-5" />
    </>
  ),
  engine: (
    <>
      <path d="M7 6h5l1.5 2H17v3h2v-2h3v8h-3v-2h-2v3h-4.5L11 20H7l-1.5-2H3v-4H1v-3h2V8h4z" />
      <path d="M9 3v3" />
    </>
  ),
  body: (
    <>
      <path d="M2 14l2-4.5C4.7 8 6 7 8 7h6c2 0 3.6.8 5 2.5L21 12l1 2v3h-2.5" />
      <path d="M2 14v3h2.5M8.5 17h7" />
      <circle cx="6.25" cy="17" r="2.25" />
      <circle cx="17.75" cy="17" r="2.25" />
    </>
  ),
  interior: (
    <>
      <path d="M7 4h6M10 4v5" />
      <path d="M6 13c0-2.5 1.8-4 4-4s4 1.5 4 4v3H6z" />
      <path d="M5 21c1.4-1.6 3.1-2 5-2s3.6.4 5 2" />
    </>
  ),
  brakes: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 5.5v2M12 16.5v2M5.5 12h2M16.5 12h2" />
    </>
  ),
  wheel: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 9.5V4M14.2 13.3l4.7 2.9M9.8 13.3l-4.7 2.9" />
    </>
  ),
};

export function CategoryIcon({
  name,
  className = "h-7 w-7",
}: {
  name: CategoryIconName;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {paths[name]}
    </svg>
  );
}
