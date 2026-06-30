interface Window {
  electron: {
    selectFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>;
    openOutput: (filePath: string) => Promise<void>;
    getConfig: () => Promise<{ backendUrl: string }>;
    saveConfig: (cfg: { backendUrl: string }) => Promise<boolean>;
    runAnnotation: (args: {
      videoPath: string;
      tier: string;
      framesPerSec: number;
      context: string;
      apiKey: string;
      model: string;
      apiUrl: string;
      annotationId: number;
    }) => Promise<{
      segments: unknown[];
      tokens_used: number;
      cost_usd: number;
      segment_count: number;
      duration: number;
      annotation_id: number;
    }>;
    onProgress: (cb: (data: Record<string, unknown>) => void) => void;
    removeProgressListener: () => void;
  };
}
