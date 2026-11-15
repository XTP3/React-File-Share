import { usePreviewNavigation, type PreviewSession } from "@/lib/preview-context";
import { FilePreview } from "./FilePreview";

export function PreviewNavigator({ initial, onClose }: { initial: PreviewSession; onClose: () => void }) {
  const { file, navigation } = usePreviewNavigation(initial);
  return <FilePreview file={file} navigation={navigation} onClose={onClose} />;
}
