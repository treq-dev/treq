import useSWR from "swr";
import { FileText, Images } from "lucide-react";
import { useState } from "react";
import { listSendArtifacts } from "../lib/api";
import {
  mergeSendAssets,
  sendRecordToAsset,
  treqSendFileSrc,
  type TreqSendAsset,
} from "../lib/treqSend";
import { useTreqSendStore } from "../stores/treqSendStore";
import { SendAssetLightbox } from "./terminal/SendAssetLightbox";
import { Button } from "./ui/button";

interface ArtifactsPageProps {
  repoPath: string;
  onClose: () => void;
}

export const ArtifactsPage: React.FC<ArtifactsPageProps> = ({
  repoPath,
  onClose,
}) => {
  const sendAssets = useTreqSendStore((s) => s.assets);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const { data: historical = [] } = useSWR(
    repoPath ? ["send-artifacts", repoPath] : null,
    () => listSendArtifacts(repoPath),
  );

  const assets = (() => {
    const fromDisk = historical.map(sendRecordToAsset);
    return mergeSendAssets(fromDisk, sendAssets);
  })();

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="border-b border-border px-6 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Images className="w-4 h-4 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Artifacts</h1>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {assets.length === 0 ? (
          <div
            data-testid="artifacts-empty"
            className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-2"
          >
            <Images className="w-8 h-8" />
            <p>No artifacts yet</p>
            <p className="text-sm">
              Files sent with <code className="font-mono">treq send</code> show
              up here.
            </p>
          </div>
        ) : (
          <div
            data-testid="artifacts-grid"
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
          >
            {assets.map((asset, index) => (
              <ArtifactThumbnail
                key={asset.id}
                asset={asset}
                onOpen={() => setPreviewIndex(index)}
              />
            ))}
          </div>
        )}
      </div>

      {previewIndex != null && assets[previewIndex] && (
        <SendAssetLightbox
          assets={assets}
          initialIndex={previewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
};

function ArtifactThumbnail({
  asset,
  onOpen,
}: {
  asset: TreqSendAsset;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`artifact-thumb-${asset.id}`}
      aria-label={`Preview ${asset.title}`}
      onClick={onOpen}
      className="group flex flex-col overflow-hidden rounded-lg border border-border bg-muted/40 text-left hover:border-primary/50 hover:bg-muted/70 transition-colors"
    >
      <div className="aspect-[4/3] bg-[#1e1e1e] flex items-center justify-center overflow-hidden">
        {asset.mediaType === "image" ? (
          <img
            src={treqSendFileSrc(asset.path)}
            alt={asset.title}
            className="h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex flex-col items-center gap-1 px-2 text-muted-foreground">
            <FileText className="w-8 h-8" />
            <span className="w-full truncate text-center text-[10px] leading-tight">
              {asset.title}
            </span>
          </div>
        )}
      </div>
      <div className="px-2 py-1.5 text-xs truncate text-foreground">
        {asset.title}
      </div>
    </button>
  );
}
