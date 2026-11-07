import { TOOLS } from "@/lib/tools";

export function ToolList() {
  return (
    <section id="tools" className="mx-auto w-full max-w-6xl scroll-mt-6 px-5 pb-20">
      <h2 className="font-display text-2xl">도구 목록</h2>
      <ul className="mt-5 divide-y divide-border border-y border-border">
        {TOOLS.map((tool) => (
          <li key={tool.name} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 py-4">
            <span className="font-medium sm:w-56">{tool.name}</span>
            <span className="flex-1 text-muted-foreground">{tool.description}</span>
            <span className={tool.available ? "text-sm font-medium text-primary" : "text-sm text-muted-foreground"}>
              {tool.available ? "사용 가능" : "준비 중"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
