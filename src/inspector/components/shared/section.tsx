import { useState, type ReactNode } from "react";

type TSectionProps = {
	title: string;
	children: ReactNode;
	defaultOpen?: boolean;
	badge?: string;
	badgeColor?: string;
};

export function Section({
	title,
	children,
	defaultOpen = true,
	badge,
	badgeColor = "text-neutral-400",
}: TSectionProps) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<div className="mb-2">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex w-full items-center gap-2 py-1 text-left text-xs font-bold text-neutral-400 hover:text-neutral-200"
			>
				<span className="text-[10px]">{open ? "▼" : "▶"}</span>
				<span>{title}</span>
				{badge && (
					<span className={`ml-auto font-mono text-[10px] ${badgeColor}`}>
						{badge}
					</span>
				)}
			</button>
			{open && <div className="pl-3 pt-1">{children}</div>}
		</div>
	);
}
