import { useState } from "react";
import { MousePointerClick, RotateCw, Send } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import { isAllowedBrowserUrl } from "./utils";

export interface AddressBarProps {
	url: string;
	onNavigate: (url: string) => void;
	onReload: () => void;
	selectMode: boolean;
	onToggleSelectMode: () => void;
	disabled?: boolean;
}

export function AddressBar({
	url,
	onNavigate,
	onReload,
	selectMode,
	onToggleSelectMode,
	disabled,
}: AddressBarProps) {
	const [draft, setDraft] = useState(url);
	const isValid =
		draft.trim().length === 0 || isAllowedBrowserUrl(draft.trim());

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		const trimmed = draft.trim();
		if (!trimmed || !isAllowedBrowserUrl(trimmed)) return;
		onNavigate(trimmed);
	};

	return (
		<form
			className="flex items-center gap-2 border-b px-3 py-2"
			onSubmit={handleSubmit}
		>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				aria-label="Reload page"
				onClick={onReload}
				disabled={disabled}
			>
				<RotateCw className="w-4 h-4" />
			</Button>
			<Input
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				placeholder="http://localhost:3000 or file:///path/to/index.html"
				aria-label="Browser URL"
				className={cn(
					!isValid && "border-destructive focus-visible:ring-destructive",
				)}
				disabled={disabled}
			/>
			<Button
				type="submit"
				size="sm"
				disabled={disabled || !draft.trim() || !isValid}
			>
				<Send className="w-3 h-3" />
				Go
			</Button>
			<Button
				type="button"
				size="sm"
				variant={selectMode ? "default" : "outline"}
				aria-pressed={selectMode}
				onClick={onToggleSelectMode}
				disabled={disabled}
				className="gap-1.5"
			>
				<MousePointerClick className="w-3.5 h-3.5" />
				Select element
			</Button>
			{!isValid && draft.trim().length > 0 && (
				<span className="text-xs text-destructive whitespace-nowrap">
					Only http://localhost, http://127.0.0.1 and file:// URLs are supported
				</span>
			)}
		</form>
	);
}
