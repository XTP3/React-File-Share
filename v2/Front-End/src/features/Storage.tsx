import { HardDrive, Files, FolderOpen, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { bytes, formatDate } from "@/lib/api";
import {
  categoryLabels,
  type StorageStats,
  type PublicConfig,
} from "@/lib/types";
export function Storage({
  stats,
  collectionCount,
  onRefresh,
  refreshing,
  config,
  scope = "library",
}: {
  stats?: StorageStats;
  collectionCount: number;
  onRefresh: () => void;
  refreshing: boolean;
  config?: PublicConfig;
  scope?: "library" | "collection";
}) {
  return (
    <section className="stats-grid" aria-label="Storage overview">
      <Card>
        <CardContent>
          <div className="stat-label">
            <HardDrive />
            File storage
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Reconcile storage"
              disabled={refreshing}
              onClick={onRefresh}
            >
              <RefreshCw className={refreshing ? "animate-spin" : ""} />
            </Button>
          </div>
          {stats ? (
            <>
              <strong>{bytes(stats.totalBytes)}</strong>
              <div className="storage-bar" aria-label="Storage by file type">
                {stats.categories
                  .filter((c) => c.bytes > 0)
                  .map((c, i) => (
                    <span
                      key={c.category}
                      title={`${categoryLabels[c.category]}: ${bytes(c.bytes)}`}
                      style={{ flex: c.bytes, opacity: 1 - i * 0.1 }}
                    />
                  ))}
              </div>
              <div className="storage-details-row">
                <span className="muted stat-description">
                  File content · updated {formatDate(stats.updatedAt, config)}
                </span>
              </div>
              {(stats.missingFiles > 0 || stats.untrackedBytes > 0) && (
                <span className="muted stat-description">
                  {stats.missingFiles} missing records ·{" "}
                  {bytes(stats.untrackedBytes)} untracked
                </span>
              )}
            </>
          ) : (
            <Skeleton className="h-12 w-32" />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <div className="stat-label">
            <Files />
            {scope === "library" ? "Files in your library" : "Files in this collection"}
          </div>
          {stats ? (
            <>
              <strong>{stats.totalFiles.toLocaleString()}</strong>
            </>
          ) : (
            <Skeleton className="h-12 w-24" />
          )}
        </CardContent>
      </Card>
      {scope === "library" && <Card>
        <CardContent>
          <div className="stat-label">
            <FolderOpen />
            Your collections
          </div>
          <strong>{collectionCount}</strong>
        </CardContent>
      </Card>}
      {stats && <div className="storage-breakdown">
        <h3>Storage by type</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File type</TableHead>
              <TableHead>Files</TableHead>
              <TableHead>Storage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.categories.map((c) => (
              <TableRow key={c.category}>
                <TableCell>{categoryLabels[c.category]}</TableCell>
                <TableCell>{c.count.toLocaleString()}</TableCell>
                <TableCell>{bytes(c.bytes)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>}
    </section>
  );
}
