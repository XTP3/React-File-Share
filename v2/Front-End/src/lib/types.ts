export type Category =
  | "photo"
  | "gif"
  | "video"
  | "audio"
  | "document"
  | "archive"
  | "other";
export const categories: Category[] = [
  "photo",
  "gif",
  "video",
  "audio",
  "document",
  "archive",
  "other",
];
export const categoryLabels: Record<Category, string> = {
  photo: "Photos",
  gif: "GIFs",
  video: "Videos",
  audio: "Audio",
  document: "Documents",
  archive: "Archives",
  other: "Other",
};
export interface SharedFile {
  _id: string;
  uniqueID: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  uploaderID: string;
  timeOfUpload: number;
  timeOfUploadDate: string;
  category: Category;
}
export interface Collection {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  fileCount: number;
  totalBytes: number;
}
export interface StorageStats {
  totalBytes: number;
  totalFiles: number;
  categories: { category: Category; count: number; bytes: number }[];
  updatedAt: number;
  missingFiles: number;
  untrackedBytes: number;
}
export interface Session {
  user: { uniqueID: string; username: string };
  csrfToken: string;
}
export interface PublicConfig {
  version: string;
  maxUploadSize: number;
  dateLanguage: string;
  timeZone: string;
}
export interface Page {
  items: SharedFile[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
export interface ExplorerPreferences {
  view: "list" | "grid";
  sort: "name" | "date" | "size" | "type";
  direction: "asc" | "desc";
  pageSize: number;
  q: string;
  categories: Category[];
  minSize: string;
  maxSize: string;
  from: string;
  to: string;
}
export const defaultPreferences: ExplorerPreferences = {
  view: "list",
  sort: "date",
  direction: "desc",
  pageSize: 25,
  q: "",
  categories: [],
  minSize: "",
  maxSize: "",
  from: "",
  to: "",
};
