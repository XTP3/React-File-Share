import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import type { Collection } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export function collectionSummary(ids: string[], collections: Collection[]) {
  if (!ids.length) return "No collections";
  return ids.map((id) => collections.find((c) => c.id === id)?.title || "Unavailable collection").join(", ");
}

export function UploadCollectionPicker({ label, caption = label, ids, collections, loading, error, onRetry, onChange, onReset }: {
  label: string;
  caption?: string;
  ids: string[];
  collections: Collection[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onChange: (ids: string[]) => void;
  onReset?: () => void;
}) {
  const [search, setSearch] = useState("");
  const id = useId();
  const visible = collections.filter((c) => c.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const missing = !loading && !error ? ids.filter((value) => !collections.some((c) => c.id === value)) : [];
  return <Collapsible className="upload-collection-picker">
    <CollapsibleTrigger asChild>
      <Button variant="ghost" className="upload-collection-trigger" aria-label={label} aria-describedby={`${id}-summary`}>
        <span>{caption}<span id={`${id}-summary`}>{collectionSummary(ids, collections)}</span></span>
        <ChevronDown aria-hidden="true" />
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent><div className="upload-collection-options">
      <Input aria-label={`Search ${label.toLowerCase()}`} placeholder="Search collections…" value={search} onChange={(e) => setSearch(e.target.value)} />
      {loading ? <p role="status">Loading collections…</p> : error ? <div role="alert">Could not load collections. <Button variant="outline" onClick={onRetry}>Retry collections</Button></div> : <>
        {!collections.length && <p>No collections yet. Files can be uploaded without a collection.</p>}
        {!!collections.length && !visible.length && <p>No collections match your search.</p>}
        <div className="upload-collection-checklist" role="group" aria-label={`${label} options`}>
          {visible.map((c, index) => <Label key={c.id} htmlFor={`${id}-${index}`}><Checkbox id={`${id}-${index}`} checked={ids.includes(c.id)} onCheckedChange={(checked) => onChange(checked === true ? [...ids, c.id] : ids.filter((value) => value !== c.id))} /><span>{c.title}</span></Label>)}
        </div>
      </>}
      {missing.map((value) => <div key={value} className="upload-collection-missing" role="alert"><span>Unavailable collection</span><Button variant="outline" onClick={() => onChange(ids.filter((id) => id !== value))}>Remove unavailable</Button></div>)}
      <Button variant="ghost" disabled={!ids.length} onClick={() => onChange([])}>No collections</Button>
      {onReset && <Button variant="ghost" onClick={onReset}>Use batch defaults</Button>}
    </div></CollapsibleContent>
  </Collapsible>;
}
