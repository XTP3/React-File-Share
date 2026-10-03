import { HardDrive, Files, FolderOpen, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
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
}: {
  stats?: StorageStats;
  collectionCount: number;
  onRefresh: () => void;
  refreshing: boolean;
  config?: PublicConfig;
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
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="link"
                      size="sm"
                      className="storage-details-button"
                    >
                      Details
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="storage-breakdown" align="start">
                    <h3>Storage by type</h3>
                    <p className="muted">Each file is counted once.</p>
                    {stats.categories.map((c) => (
                      <div key={c.category}>
                        <span>{categoryLabels[c.category]}</span>
                        <span className="muted">{c.count} files</span>
                        <strong>{bytes(c.bytes)}</strong>
                      </div>
                    ))}
                  </PopoverContent>
                </Popover>
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
            Files in your library
          </div>
          {stats ? (
            <>
              <strong>{stats.totalFiles.toLocaleString()}</strong>
              <span className="muted stat-description">
                Stored once, shared anywhere
              </span>
            </>
          ) : (
            <Skeleton className="h-12 w-24" />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <div className="stat-label">
            <FolderOpen />
            Your collections
          </div>
          <strong>{collectionCount}</strong>
          <span className="muted stat-description">
            A place for every project
          </span>
        </CardContent>
      </Card>
    </section>
  );
}
