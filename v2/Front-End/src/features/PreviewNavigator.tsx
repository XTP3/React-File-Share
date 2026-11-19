import { usePreviewNavigation, type PreviewSession } from "@/lib/preview-context";
import type { PublicConfig } from "@/lib/types";
import { FilePreview } from "./FilePreview";

export function PreviewNavigator({ initial, config, onClose }: {
  initial: PreviewSession;
  config?: PublicConfig;
  onClose: () => void;
}) {
  const { file, navigation } = usePreviewNavigation(initial);
  return <FilePreview file={file} config={config} navigation={navigation} onClose={onClose} />;
}
