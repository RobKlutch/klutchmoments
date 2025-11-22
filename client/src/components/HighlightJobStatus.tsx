import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle, AlertCircle, SatelliteDish } from "lucide-react";

interface HighlightJobStatusProps {
  jobId: string;
  onComplete?: (jobId: string, payload?: any) => void;
  onError?: (message: string) => void;
}

type JobStatus = "queued" | "processing" | "done" | "failed";

export function HighlightJobStatus({ jobId, onComplete, onError }: HighlightJobStatusProps) {
  const [status, setStatus] = useState<JobStatus>("queued");
  const [progress, setProgress] = useState(10);
  const [boundingBoxes, setBoundingBoxes] = useState<any>(null);
  const [message, setMessage] = useState<string>("Analyzing players…");

  useEffect(() => {
    let mounted = true;

    const fetchStatus = async () => {
      try {
        const response = await fetch(`/api/highlight-jobs/${jobId}`);
        if (!response.ok) {
          throw new Error(`Status check failed (${response.status})`);
        }
        const payload = await response.json();

        if (!mounted) return;
        setStatus(payload.status);
        setBoundingBoxes(payload.boundingBoxes);

        switch (payload.status as JobStatus) {
          case "processing":
            setMessage("Generating spotlight overlay…");
            setProgress((prev) => Math.min(prev + 10, 80));
            break;
          case "done":
            setMessage("Highlight ready");
            setProgress(100);
            onComplete?.(jobId, payload);
            break;
          case "failed":
            setMessage(payload.error || "Highlight processing failed");
            setProgress(100);
            onError?.(payload.error || "Highlight processing failed");
            break;
          default:
            setMessage("Analyzing players…");
        }
      } catch (error) {
        if (!mounted) return;
        const message = error instanceof Error ? error.message : "Unable to fetch highlight status";
        setMessage(message);
        onError?.(message);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [jobId, onComplete, onError]);

  const statusCopy: Record<JobStatus, string> = {
    queued: "Queued",
    processing: "Processing",
    done: "Completed",
    failed: "Failed",
  };

  const statusIcon = () => {
    if (status === "done") return <CheckCircle className="w-5 h-5 text-green-600" />;
    if (status === "failed") return <AlertCircle className="w-5 h-5 text-destructive" />;
    return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
  };

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {statusIcon()}
          <div>
            <p className="text-sm font-medium">Highlight job</p>
            <p className="text-xs text-muted-foreground">ID: {jobId}</p>
          </div>
        </div>
        <Badge variant={status === "done" ? "default" : status === "failed" ? "destructive" : "secondary"}>
          {statusCopy[status]}
        </Badge>
      </div>

      <div>
        <div className="flex justify-between mb-2 text-sm">
          <span>{message}</span>
          <span className="text-muted-foreground">{progress.toFixed(0)}%</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {boundingBoxes && status === "done" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <SatelliteDish className="w-4 h-4" />
          <span>{boundingBoxes.frames?.length || 0} frames processed for spotlight overlay</span>
        </div>
      )}
    </Card>
  );
}

export default HighlightJobStatus;
