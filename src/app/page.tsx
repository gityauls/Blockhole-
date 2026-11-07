import { ImageConverter } from "@/components/convert/image-converter";
import { ToolList } from "@/components/site/tool-list";

export default function Home() {
  return (
    <main id="main">
      <ImageConverter />
      <ToolList />
    </main>
  );
}
