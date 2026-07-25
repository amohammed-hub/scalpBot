import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

interface HelpTipProps {
  content: string;
  className?: string;
}

export function HelpTip({ content, className = "" }: HelpTipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/10 hover:bg-white/20 text-white/40 hover:text-white/70 transition-colors cursor-help ${className}`}
        >
          <HelpCircle className="w-3 h-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-[280px] text-xs leading-relaxed bg-gray-900 border border-white/20 text-white/90 px-3 py-2 rounded-lg shadow-xl"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}
