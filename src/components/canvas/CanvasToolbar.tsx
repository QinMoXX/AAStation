import { useCallback } from 'react';
import { useReactFlow } from 'reactflow';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';

export default function CanvasToolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2 });
  }, [fitView]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="absolute left-[18px] bottom-[18px] z-10 flex flex-col gap-2 p-2 rounded-2xl border border-border bg-card/76 shadow-[var(--color-shadow-soft)] backdrop-blur-xl">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="w-[38px] h-[38px] rounded-xl border-border bg-surface/90"
              onClick={() => zoomIn()}
            >
              <ZoomIn className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>放大</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="w-[38px] h-[38px] rounded-xl border-border bg-surface/90"
              onClick={() => zoomOut()}
            >
              <ZoomOut className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>缩小</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="w-[38px] h-[38px] rounded-xl border-border bg-surface/90"
              onClick={handleFitView}
            >
              <Maximize className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>适配画布</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
