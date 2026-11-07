import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
      <Link href="/" className="flex items-center gap-2 font-latin text-xl font-bold">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/portal-closed.png"
          alt=""
          width={40}
          height={40}
          className="[image-rendering:pixelated]"
        />
        File-BlackHole
      </Link>
      <a href="#tools" className="text-link">
        도구 목록
      </a>
    </header>
  );
}
