import { FileConverter } from "@/components/convert/file-converter";
import { ToolList } from "@/components/site/tool-list";

export default function Home() {
  return (
    <main id="main">
      <FileConverter />
      <ToolList />
    </main>
  );
}
