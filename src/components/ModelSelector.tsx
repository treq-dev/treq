import { ClaudeIcon } from "./icons/AgentIcons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";

interface ModelSelectorProps {
  currentModel: string | null;
  onModelChange: (model: string) => Promise<void>;
  disabled?: boolean;
}

const AVAILABLE_MODELS = [
  { value: "default", label: "Default" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
  { value: "sonnet[1m]", label: "Sonnet (1M)" },
  { value: "opusplan", label: "Opus Plan" },
];

export function ModelSelector({
  currentModel,
  onModelChange,
  disabled,
}: ModelSelectorProps) {
  const getCurrentModelLabel = () => {
    if (currentModel) {
      const model = AVAILABLE_MODELS.find((m) => m.value === currentModel);
      return model?.label || currentModel;
    }
    return "Default";
  };

  const handleModelSelect = async (modelValue: string) => {
    await onModelChange(modelValue);
  };

  const isSelected = (modelValue: string) => {
    if (currentModel === null && modelValue === "default") return true;
    return currentModel === modelValue;
  };

  return (
    <DropdownMenu>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={disabled}
                className="bg-transparent text-gray-200 hover:bg-muted/20 hover:text-gray-200"
                aria-label={`Model: ${getCurrentModelLabel()}`}
              >
                <ClaudeIcon className="w-4 h-4 text-gray-200" />
                {getCurrentModelLabel()}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>{getCurrentModelLabel()}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="end" sideOffset={4}>
        {AVAILABLE_MODELS.map((model) => (
          <DropdownMenuItem
            key={model.value}
            onSelect={() => handleModelSelect(model.value)}
            className={
              isSelected(model.value)
                ? "bg-primary/15 text-primary font-medium"
                : ""
            }
          >
            {model.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
